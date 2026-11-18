import Busboy from "busboy";
import crypto from "node:crypto";
import { put, del } from "@vercel/blob";
import { getDb } from "./_lib/auth.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_CV_SIZE = 4 * 1024 * 1024;

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    let parser;

    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fields: 5,
          fileSize: MAX_CV_SIZE,
          fieldSize: 5000,
        },
      });
    } catch {
      reject(new Error("Formulaire multipart invalide."));
      return;
    }

    const fields = {};
    let fileBuffer = null;
    let fileMime = "";
    let fileName = "";
    let fileTooLarge = false;
    let fileCount = 0;
    let parserError = null;

    parser.on("field", (name, value) => {
      fields[name] = value;
    });

    parser.on("file", (name, stream, info) => {
      fileCount += 1;
      if (name !== "cv") {
        stream.resume();
        return;
      }

      fileMime = info.mimeType || "";
      fileName = info.filename || "";
      const chunks = [];

      stream.on("limit", () => {
        fileTooLarge = true;
      });

      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    parser.on("filesLimit", () => {
      parserError = new Error("Un seul CV peut être envoyé.");
    });
    parser.on("fieldsLimit", () => {
      parserError = new Error("Trop de champs dans le formulaire.");
    });
    parser.on("error", () => {
      parserError = new Error("Impossible de lire le formulaire.");
    });
    parser.on("finish", () => {
      if (parserError) return reject(parserError);
      if (fileTooLarge) return reject(new Error("Le CV ne doit pas dépasser 4 Mo."));
      resolve({ fields, fileBuffer, fileMime, fileName, fileCount });
    });

    req.pipe(parser);
  });
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      message: "Méthode non autorisée.",
    });
  }

  let uploadedPath = null;

  try {
    const { fields, fileBuffer, fileMime, fileCount } = await readMultipart(req);

    const nom = clean(fields.nom, 160);
    const email = clean(fields.email, 254).toLowerCase();
    const telephone = clean(fields.telephone, 40);
    const poste = clean(fields.poste, 160);
    const message = clean(fields.message, 3000);

    if (!nom || !telephone || !poste) {
      return res.status(400).json({
        success: false,
        message: "Le nom, le téléphone et le poste souhaité sont obligatoires.",
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "L'adresse e-mail est invalide.",
      });
    }

    if (fileCount !== 1 || !fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Veuillez joindre votre CV au format PDF.",
      });
    }

    if (fileMime !== "application/pdf" || fileBuffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return res.status(400).json({
        success: false,
        message: "Le fichier fourni n'est pas un véritable document PDF.",
      });
    }

    const pathname = `candidatures/${crypto.randomUUID()}.pdf`;
    const blob = await put(pathname, fileBuffer, {
      access: "private",
      contentType: "application/pdf",
      addRandomSuffix: false,
    });
    uploadedPath = blob.pathname;

    const sql = getDb();
    const inserted = await sql`
      INSERT INTO candidatures
        (nom, email, telephone, poste, message, cv_url, statut, date_creation)
      VALUES
        (${nom}, ${email || null}, ${telephone}, ${poste}, ${message || null},
         ${uploadedPath}, 'nouveau', NOW())
      RETURNING id
    `;

    return res.status(201).json({
      success: true,
      message: "Votre candidature a bien été envoyée. Nous vous remercions de votre intérêt.",
      id: inserted[0].id,
    });
  } catch (error) {
    if (uploadedPath) {
      try {
        await del(uploadedPath);
      } catch (cleanupError) {
        console.error("Nettoyage du CV impossible:", cleanupError);
      }
    }

    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("Le CV ne doit pas dépasser") ||
      message.includes("Formulaire multipart") ||
      message.includes("Un seul CV") ||
      message.includes("Trop de champs") ||
      message.includes("Impossible de lire")
    ) {
      return res.status(400).json({ success: false, message });
    }

    console.error("Erreur dépôt candidature:", error);
    return res.status(500).json({
      success: false,
      message: "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer.",
    });
  }
}
