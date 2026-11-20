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

function pick(columns, choices) {
  return choices.find(name => columns.has(name)) || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success:false, message:"Méthode non autorisée." });
  }

  try {
    const admin = await verifyAdmin(req);
    if (!admin) {
      return res.status(401).json({ success:false, message:"Connexion administrateur requise." });
    }

    const sql = getDb();
    const schema = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'contacts'
    `;
    const columns = new Set(schema.map(row => row.column_name));
    if (!columns.size) throw new Error("La table contacts est introuvable.");

    const fields = [
      ["id", pick(columns, ["id"])],
      ["nom", pick(columns, ["nom", "name", "full_name"])],
      ["telephone", pick(columns, ["telephone", "phone"])],
      ["email", pick(columns, ["email"])],
      ["sujet", pick(columns, ["sujet", "objet", "subject"])],
      ["message", pick(columns, ["message", "contenu"])],
      ["statut", pick(columns, ["statut", "status"])],
      ["date_creation", pick(columns, ["date_creation", "created_at"])]
    ];

    const selected = fields
      .filter(([, column]) => column)
      .map(([alias, column]) => column === alias ? column : `${column} AS ${alias}`);

    if (!selected.length) throw new Error("Aucune colonne exploitable dans la table contacts.");

    const orderColumn = pick(columns, ["date_creation", "created_at", "id"]);
    const order = orderColumn ? ` ORDER BY ${orderColumn} DESC` : "";
    const contacts = await sql.query(
      `SELECT ${selected.join(", ")} FROM contacts${order} LIMIT 200`,
      []
    );

    return res.status(200).json({ success:true, contacts });
  } catch (error) {
    console.error("Erreur liste contacts:", error);
    return res.status(500).json({
      success:false,
      message:"Impossible de charger les messages pour le moment."
    });
  }
}
