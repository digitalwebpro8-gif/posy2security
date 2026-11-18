
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
        message: "Connexion administrateur requise."
      });
    }

    const sql = getDb();
    const tokenHash = hashSessionToken(token);

    const admins = await sql`
      SELECT a.id, a.nom, a.email, a.role
      FROM sessions_admin s
      INNER JOIN administrateurs a
        ON a.id = s.administrateur_id
      WHERE s.jeton_hash = ${tokenHash}
        AND s.expiration > NOW()
        AND a.statut = 'actif'
      LIMIT 1
    `;

    if (admins.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Session invalide ou expirée."
      });
    }

    const [
      contacts,
      devis,
      candidatures,
      offres,
      actualites,
      services,
      administrateurs
    ] = await Promise.all([
      sql`SELECT COUNT(*)::int AS total FROM contacts`,
      sql`SELECT COUNT(*)::int AS total FROM devis`,
      sql`SELECT COUNT(*)::int AS total FROM candidatures`,
      sql`SELECT COUNT(*)::int AS total FROM offres_emploi`,
      sql`SELECT COUNT(*)::int AS total FROM actualites`,
      sql`SELECT COUNT(*)::int AS total FROM services WHERE actif = TRUE`,
      sql`SELECT COUNT(*)::int AS total FROM administrateurs WHERE statut = 'actif'`
    ]);

    return res.status(200).json({
      success: true,
      administrateur: admins[0],
      statistiques: {
        contacts: contacts[0].total,
        devis: devis[0].total,
        candidatures: candidatures[0].total,
        offresEmploi: offres[0].total,
        actualites: actualites[0].total,
        servicesActifs: services[0].total,
        administrateurs: administrateurs[0].total
      }
    });

  } catch (error) {
    console.error("Erreur tableau de bord:", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de charger les statistiques."
    });
  }
}
