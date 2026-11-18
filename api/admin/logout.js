
import {
  getDb,
  getCookie,
  hashSessionToken,
  clearSessionCookie,
  SESSION_COOKIE
} from "../_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Méthode non autorisée."
    });
  }

  try {
    const token = getCookie(req, SESSION_COOKIE);

    if (token) {
      const tokenHash = hashSessionToken(token);
      const sql = getDb();

      await sql`
        DELETE FROM sessions_admin
        WHERE jeton_hash = ${tokenHash}
      `;
    }

    clearSessionCookie(res);

    return res.status(200).json({
      success: true,
      message: "Déconnexion réussie."
    });

  } catch (error) {
    console.error("Erreur déconnexion administrateur:", error);

    clearSessionCookie(res);

    return res.status(500).json({
      success: false,
      message: "Une erreur est survenue lors de la déconnexion."
    });
  }
}
