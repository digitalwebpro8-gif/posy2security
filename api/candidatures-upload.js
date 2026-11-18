import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Méthode non autorisée." });
  }

  try {
    const result = await handleUpload({
      body: req.body,
      request: req,
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
      message: error instanceof Error ? error.message : "Téléversement du CV impossible.",
    });
  }
}
