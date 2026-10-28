import fs from "fs";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { checkQdrantDbExists, initQdrantDb } from "./init-qdrant-db";

export interface ProcessPdfOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  collectionName?: string;
  vectorSize?: number;
  qdrantUrl?: string;
  qdrantApiKey?: string;
}

// Here we are gonna only send pdfs
// make a exportable function that recives a path
// check if pdf is a text based or not if not then return say not supported yet otherwise you can do the next step.
// it fetches the pdf using langchains pdf loader
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

  // Fetch the PDF using LangChain's PDFLoader
  const loader = new PDFLoader(filePath);
  const docs = await loader.load();

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

  // Embeddings using OpenAIEmbeddings (reads OPENAI_API_KEY and OPENAI_BASE_URL from env)
  const embeddings = new OpenAIEmbeddings({
    apiKey: process.env.OPENAI_API_KEY || undefined,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    },
  });

  // Store in Qdrant vector database
  const store = await QdrantVectorStore.fromDocuments(splitDocs, embeddings, {
    url: qdrantUrl,
    apiKey: qdrantApiKey,
    collectionName: collectionName,
  });

  // Return the store
  return store;
}

export { processPdf as extractAndStorePdf };
export default processPdf;
