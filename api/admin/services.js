import {
  getDb,
  getCookie,
  hashSessionToken,
  SESSION_COOKIE
} from "../../lib/auth.js";

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
  if (!["GET", "POST", "PUT"].includes(req.method)) {
    return res.status(405).json({ success: false, message: "Méthode non autorisée." });
  }

  try {
    const admin = await verifyAdmin(req);
    if (!admin) {
      return res.status(401).json({ success: false, message: "Connexion administrateur requise." });
    }

    const sql = getDb();

    if (req.method === "GET") {
      const services = await sql`
        SELECT id, titre, description, actif
        FROM services
        ORDER BY id ASC
      `;
      return res.status(200).json({ success: true, services });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const titre = String(body.titre || "").trim();
    const description = String(body.description || "").trim();
    const actif = body.actif !== false;

    if (!titre) {
      return res.status(400).json({ success: false, message: "Le titre du service est obligatoire." });
    }

    if (titre.length > 160 || description.length > 3000) {
      return res.status(400).json({ success: false, message: "Le titre ou la description est trop long." });
    }

    if (req.method === "POST") {
      const inserted = await sql`
        INSERT INTO services (titre, description, actif)
        VALUES (${titre}, ${description || null}, ${actif})
        RETURNING id, titre, description, actif
      `;
      return res.status(201).json({ success: true, service: inserted[0], message: "Service ajouté." });
    }

    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: "Identifiant de service invalide." });
    }

    const updated = await sql`
      UPDATE services
      SET titre = ${titre},
          description = ${description || null},
          actif = ${actif}
      WHERE id = ${id}
      RETURNING id, titre, description, actif
    `;

    if (updated.length === 0) {
      return res.status(404).json({ success: false, message: "Service introuvable." });
    }

    return res.status(200).json({ success: true, service: updated[0], message: "Service modifié." });
  } catch (error) {
    console.error("Erreur gestion services:", error);
    return res.status(500).json({ success: false, message: "Une erreur est survenue lors de la gestion des services." });
  }
}
