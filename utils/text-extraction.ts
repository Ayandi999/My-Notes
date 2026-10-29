import fs from "fs";
import { Document } from "@langchain/core/documents";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { PDFParse } from "pdf-parse";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { checkQdrantDbExists, initQdrantDb } from "./init-qdrant-db";

export interface ProcessPdfOptions {
  fileId?: string;
  userId?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  collectionName?: string;
  embeddingModel?: string;
  vectorSize?: number;
  qdrantUrl?: string;
  qdrantApiKey?: string;
}

/**
 * Pre-load pdfjs worker onto globalThis so that neither pdfjs-dist nor PDFLoader
 * fails with "Setting up fake worker failed: Cannot find module pdf.worker.mjs"
 * inside Next.js / Turbopack server runtime chunks.
 */
async function initPdfWorker(): Promise<void> {
  if (typeof globalThis !== "undefined" && !(globalThis as Record<string, unknown>).pdfjsWorker) {
    try {
      // @ts-expect-error - internal pdfjs-dist worker bundle
      const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      (globalThis as Record<string, unknown>).pdfjsWorker = pdfjsWorker;
    } catch {
      // Ignore if worker cannot be pre-loaded dynamically
    }
  }
}

/**
 * Extracts documents from a PDF file using PDFParse with fallback to PDFLoader.
 */
async function extractPdfDocuments(filePath: string): Promise<Document[]> {
  await initPdfWorker();

  // Try direct PDFParse extraction first
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
    const textResult = await parser.getText();
    await parser.destroy();

    const docs: Document[] = [];
    if (textResult.pages && textResult.pages.length > 0) {
      for (const page of textResult.pages) {
        if (page.text && page.text.trim().length > 0) {
          docs.push(
            new Document({
              pageContent: page.text,
              metadata: {
                source: filePath,
                loc: { pageNumber: page.num },
                pdf: { totalPages: textResult.total },
              },
            })
          );
        }
      }
    }

    if (docs.length > 0) {
      return docs;
    }

    // If textResult has text but pages array was empty/unsplit
    if (textResult.text && textResult.text.trim().length > 0) {
      return [
        new Document({
          pageContent: textResult.text.trim(),
          metadata: {
            source: filePath,
            pdf: { totalPages: textResult.total },
          },
        }),
      ];
    }
  } catch (err) {
    console.warn("Direct PDFParse failed, trying LangChain PDFLoader fallback:", err);
  }

  // Fallback to LangChain PDFLoader
  const loader = new PDFLoader(filePath);
  return await loader.load();
}

// Here we are gonna only send pdfs
// make a exportable function that recives a path
// check if pdf is a text based or not if not then return say not supported yet otherwise you can do the next step.
// it fetches the pdf using langchains pdf loader / pdf-parse
// it checks if the pdf exist if not error.
// it does the chunking using langchain libraries RecurrsiveCharacterTextspitter and split docs
// embedd the extracted text will add api key and base url in .env you make a.env keep fields empty
// store it in qwadrantdb [go to the docke compoise remove whatever is in it and add qwadrant instead don not run docker compose up -d].
// return the store.

export async function processPdf(
  filePath: string,
  options?: ProcessPdfOptions
): Promise<QdrantVectorStore | "not supported yet"> {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist at path: ${filePath}`);
  }

  // Validate that the file is a PDF
  if (!filePath.toLowerCase().endsWith(".pdf")) {
    throw new Error(`Invalid file type. Only PDF files are supported: ${filePath}`);
  }

  // Extract PDF documents
  const docs = await extractPdfDocuments(filePath);

  // Check if PDF is text-based or not (e.g. scanned / image-only PDF)
  const isTextBased =
    docs.length > 0 &&
    docs.some((doc) => doc.pageContent && doc.pageContent.trim().length > 0);

  if (!isTextBased) {
    return "not supported yet";
  }

  // Chunking using LangChain RecursiveCharacterTextSplitter
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: options?.chunkSize ?? 1000,
    chunkOverlap: options?.chunkOverlap ?? 200,
  });

  const splitDocs = await textSplitter.splitDocuments(docs);

  // Attach fileId and userId to chunk metadata for pinpoint search and deletion
  if (options?.fileId || options?.userId) {
    for (const doc of splitDocs) {
      if (options.fileId) doc.metadata.fileId = options.fileId;
      if (options.userId) doc.metadata.userId = options.userId;
    }
  }

  // Qdrant connection configuration
  const qdrantUrl =
    options?.qdrantUrl || process.env.QDRANT_URL || "http://localhost:6333";
  const rawApiKey = options?.qdrantApiKey ?? process.env.QDRANT_API_KEY;
  const qdrantApiKey =
    rawApiKey && rawApiKey.trim().length > 0 ? rawApiKey.trim() : undefined;
  const collectionName =
    options?.collectionName ||
    process.env.QDRANT_COLLECTION_NAME ||
    "memory";

  // Check if Qdrant database/collection exists before embedding
  const dbExists = await checkQdrantDbExists({
    collectionName,
    url: qdrantUrl,
    apiKey: qdrantApiKey,
  });

  // If not, call the init function to create and configure the collection
  if (!dbExists) {
    await initQdrantDb({
      collectionName,
      url: qdrantUrl,
      apiKey: qdrantApiKey,
      vectorSize: options?.vectorSize ?? 1536,
    });
  }

  // Embeddings using OpenAIEmbeddings (reads OPENAI_API_KEY, OPENAI_BASE_URL, and OPENAI_EMBEDDING_MODEL from env)
  const embeddingModel =
    options?.embeddingModel ||
    process.env.OPENAI_EMBEDDING_MODEL ||
    process.env.EMBEDDING_MODEL ||
    "text-embedding-3-small";

  const embeddings = new OpenAIEmbeddings({
    model: embeddingModel,
    apiKey: process.env.OPENAI_API_KEY || undefined,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    },
  });

  // Store in Qdrant vector database
  const qdrantStoreOptions: {
    url: string;
    collectionName: string;
    apiKey?: string;
  } = {
    url: qdrantUrl,
    collectionName: collectionName,
  };
  if (qdrantApiKey) {
    qdrantStoreOptions.apiKey = qdrantApiKey;
  }

  const store = await QdrantVectorStore.fromDocuments(splitDocs, embeddings, qdrantStoreOptions);

  // Return the store
  return store;
}

export { processPdf as extractAndStorePdf };
export default processPdf;
