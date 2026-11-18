import { get } from "@vercel/blob";
import { Readable } from "node:stream";
import {
  getDb,
  getCookie,
  hashSessionToken,
  SESSION_COOKIE,
} from "../_lib/auth.js";

async function verifyAdmin(req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const sql = getDb();
  const tokenHash = hashSessionToken(token);
  const admins = await sql`
    SELECT a.id, a.nom, a.role
    FROM sessions_admin s
    INNER JOIN administrateurs a ON a.id = s.administrateur_id
    WHERE s.jeton_hash = ${tokenHash}
      AND s.expiration > NOW()
      AND a.statut = 'actif'
    LIMIT 1
  `;
  return admins[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      success: false,
      message: "Méthode non autorisée.",
    });
  }

  try {
    const admin = await verifyAdmin(req);
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Connexion administrateur requise.",
      });
    }

    const pathname = String(req.query?.pathname || "");
    if (!/^candidatures\/[0-9a-f-]{36}\.pdf$/i.test(pathname)) {
      return res.status(400).json({
        success: false,
        message: "Référence du CV invalide.",
      });
    }

    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200) {
      return res.status(404).json({
        success: false,
        message: "CV introuvable.",
      });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="CV-candidature.pdf"');
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store, max-age=0");

    Readable.fromWeb(result.stream).pipe(res);
  } catch (error) {
    console.error("Erreur lecture CV:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Impossible de récupérer ce CV pour le moment.",
      });
    }
    res.end();
  }
}
