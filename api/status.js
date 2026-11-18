
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Méthode non autorisée."
    });
  }

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL n'est pas configurée.");
    }

    const sql = neon(process.env.DATABASE_URL);

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;

    return res.status(200).json({
      success: true,
      message: "Connexion à la base POSY2SECURITY réussie.",
      tables: tables.map(row => ({
        name: row.table_name
      }))
    });
  } catch (error) {
    console.error("Erreur API status:", error);

    return res.status(500).json({
      success: false,
      message: "Impossible de se connecter à la base de données."
    });
  }
}
