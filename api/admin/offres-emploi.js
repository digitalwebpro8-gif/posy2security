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
      const offres = await sql`
        SELECT id, titre, description, lieu, type_contrat, profil_recherche,
               date_limite, email_candidature, statut, date_creation
        FROM offres_emploi
        ORDER BY date_creation DESC, id DESC
      `;
      return res.status(200).json({ success: true, offres });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const titre = String(body.titre || "").trim();
    const description = String(body.description || "").trim();
    const lieu = String(body.lieu || "").trim();
    const typeContrat = String(body.type_contrat || "").trim();
    const profil = String(body.profil_recherche || "").trim();
    const email = String(body.email_candidature || "").trim();
    const dateLimite = body.date_limite ? String(body.date_limite).trim() : null;
    const statut = String(body.statut || "brouillon").trim();

    if (!titre) {
      return res.status(400).json({ success: false, message: "Le titre du poste est obligatoire." });
    }
    if (titre.length > 180 || description.length > 6000 || lieu.length > 180 ||
        typeContrat.length > 100 || profil.length > 4000 || email.length > 254) {
      return res.status(400).json({ success: false, message: "Un ou plusieurs champs dépassent la longueur autorisée." });
    }
    if (!["brouillon", "publiee"].includes(statut)) {
      return res.status(400).json({ success: false, message: "Statut d'offre invalide." });
    }
    if (dateLimite && !/^\d{4}-\d{2}-\d{2}$/.test(dateLimite)) {
      return res.status(400).json({ success: false, message: "La date limite est invalide." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "L'adresse e-mail de candidature est invalide." });
    }

    if (req.method === "POST") {
      const inserted = await sql`
        INSERT INTO offres_emploi
          (titre, description, lieu, type_contrat, profil_recherche, date_limite, email_candidature, statut)
        VALUES
          (${titre}, ${description || null}, ${lieu || null}, ${typeContrat || null},
           ${profil || null}, ${dateLimite}, ${email || null}, ${statut})
        RETURNING id, titre, description, lieu, type_contrat, profil_recherche,
                  date_limite, email_candidature, statut, date_creation
      `;
      return res.status(201).json({ success: true, offre: inserted[0], message: "Offre enregistrée." });
    }

    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: "Identifiant d'offre invalide." });
    }

    const updated = await sql`
      UPDATE offres_emploi
      SET titre = ${titre},
          description = ${description || null},
          lieu = ${lieu || null},
          type_contrat = ${typeContrat || null},
          profil_recherche = ${profil || null},
          date_limite = ${dateLimite},
          email_candidature = ${email || null},
          statut = ${statut}
      WHERE id = ${id}
      RETURNING id, titre, description, lieu, type_contrat, profil_recherche,
                date_limite, email_candidature, statut, date_creation
    `;
    if (!updated.length) {
      return res.status(404).json({ success: false, message: "Offre introuvable." });
    }
    return res.status(200).json({ success: true, offre: updated[0], message: "Offre modifiée." });
  } catch (error) {
    console.error("Erreur gestion offres d'emploi:", error);
    return res.status(500).json({ success: false, message: "Une erreur est survenue lors de la gestion des offres." });
  }
}
