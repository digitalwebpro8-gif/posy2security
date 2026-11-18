import { head, get, del } from "@vercel/blob";
import { getDb } from "./_lib/auth.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 32 * 1024) {
      throw new Error("Données de candidature trop volumineuses.");
    }
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

const MAX_CV_SIZE = 10 * 1024 * 1024;
const CV_PATH_PATTERN = /^candidatures\/[0-9a-f-]{36}\.pdf$/i;

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function hasPdfSignature(pathname) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return false;

  const reader = result.stream.getReader();
  let prefix = Buffer.alloc(0);

  try {
    while (prefix.length < 5) {
      const { done, value } = await reader.read();
      if (done) break;
      prefix = Buffer.concat([prefix, Buffer.from(value)]);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return prefix.subarray(0, 5).toString("ascii") === "%PDF-";
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
    const body = await readJsonBody(req);
    const nom = clean(body.nom, 160);
    const email = clean(body.email, 254).toLowerCase();
    const telephone = clean(body.telephone, 40);
    const poste = clean(body.poste, 160);
    const message = clean(body.message, 3000);
    const cvPath = clean(body.cvPath, 220);

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

    if (!CV_PATH_PATTERN.test(cvPath)) {
      return res.status(400).json({
        success: false,
        message: "Veuillez joindre votre CV au format PDF.",
      });
    }

    uploadedPath = cvPath;
    const metadata = await head(cvPath);

    if (metadata.size > MAX_CV_SIZE) {
      await del(cvPath);
      uploadedPath = null;
      return res.status(400).json({
        success: false,
        message: "Le CV ne doit pas dépasser 10 Mo.",
      });
    }

    if (metadata.contentType !== "application/pdf" || !(await hasPdfSignature(cvPath))) {
      await del(cvPath);
      uploadedPath = null;
      return res.status(400).json({
        success: false,
        message: "Le fichier fourni n'est pas un véritable document PDF.",
      });
    }

    const sql = getDb();
    const inserted = await sql`
      INSERT INTO candidatures
        (nom, email, telephone, poste, message, cv_url, statut, date_creation)
      VALUES
        (${nom}, ${email || null}, ${telephone}, ${poste}, ${message || null},
         ${cvPath}, 'nouveau', NOW())
      RETURNING id
    `;

    uploadedPath = null;

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

    console.error("Erreur dépôt candidature:", error);
    return res.status(500).json({
      success: false,
      message: "Une erreur est survenue lors de l'envoi de votre candidature. Veuillez réessayer.",
    });
  }
}
