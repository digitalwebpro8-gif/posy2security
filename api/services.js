import { getDb } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Méthode non autorisée." });
  }

  try {
    const sql = getDb();
    const services = await sql`
      SELECT id, titre, description
      FROM services
      WHERE actif = TRUE
      ORDER BY id ASC
    `;

    return res.status(200).json({ success: true, services });
  } catch (error) {
    console.error("Erreur chargement services publics:", error);
    return res.status(500).json({ success: false, message: "Impossible de charger les services." });
  }
}
