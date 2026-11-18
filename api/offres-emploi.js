import { getDb } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Méthode non autorisée." });
  }

  try {
    const sql = getDb();
    const offres = await sql`
      SELECT id, titre, description, lieu, type_contrat, profil_recherche,
             date_limite, email_candidature, date_creation
      FROM offres_emploi
      WHERE statut = 'publiee'
        AND (date_limite IS NULL OR date_limite >= CURRENT_DATE)
      ORDER BY date_creation DESC, id DESC
    `;
    return res.status(200).json({ success: true, offres });
  } catch (error) {
    console.error("Erreur chargement offres publiques:", error);
    return res.status(500).json({ success: false, message: "Impossible de charger les offres d'emploi." });
  }
}
