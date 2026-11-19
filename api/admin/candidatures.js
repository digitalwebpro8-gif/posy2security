import {
  getDb,
  getCookie,
  hashSessionToken,
  SESSION_COOKIE,
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

    const sql = getDb();
    const candidatures = await sql`
      SELECT
        id,
        nom,
        email,
        telephone,
        poste,
        message,
        cv_url,
        statut,
        date_creation
      FROM candidatures
      ORDER BY date_creation DESC, id DESC
    `;

    return res.status(200).json({
      success: true,
      candidatures,
    });
  } catch (error) {
    console.error("Erreur liste candidatures:", error);
    return res.status(500).json({
      success: false,
      message: "Impossible de charger les candidatures pour le moment.",
    });
  }
}
