import { handleUpload } from "@vercel/blob/client";

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;

    if (total > 32 * 1024) {
      throw new Error("Demande de téléversement trop volumineuse.");
    }

    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  if (!raw) {
    throw new Error("Demande de téléversement vide.");
  }

  return JSON.parse(raw);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      message: "Méthode non autorisée.",
    });
  }

  try {
    const body = await readJsonBody(req);

    const result = await handleUpload({
      body,
      request: req,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^candidatures\/[0-9a-f-]{36}\.pdf$/i.test(String(pathname || ""))) {
          throw new Error("Chemin de CV invalide.");
        }

        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 10 * 1024 * 1024,
          addRandomSuffix: false,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("CV de candidature téléversé:", {
          pathname: blob.pathname,
          size: blob.size,
        });
      },
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Erreur autorisation téléversement CV:", error);

    return res.status(400).json({
      success: false,
      message: error instanceof Error
        ? error.message
        : "Téléversement du CV impossible.",
    });
  }
}
