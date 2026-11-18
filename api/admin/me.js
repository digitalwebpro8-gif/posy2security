
import {
  getDb,
  getCookie,
  hashSessionToken,
  SESSION_COOKIE
} from "../_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Méthode non autorisée."
    });
  }

  try {
    const token = getCookie(req, SESSION_COOKIE);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Aucune session active."
      });
    }

    const tokenHash = hashSessionToken(token);
    const sql = getDb();

    const sessions = await sql`
      SELECT
        a.id,
        a.nom,
        a.email,
        a.role
      FROM sessions_admin s
      INNER JOIN administrateurs a
        ON a.id = s.administrateur_id
      WHERE s.jeton_hash = ${tokenHash}
        AND s.expiration > NOW()
        AND a.statut = 'actif'
      LIMIT 1
    `;

    if (sessions.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Session expirée ou invalide."
      });
    }

    return res.status(200).json({
      success: true,
      administrateur: sessions[0]
    });

  } catch (error) {
    console.error("Erreur vérification session:", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de vérifier la session."
    });
  }
}
