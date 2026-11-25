import {
  getDb,
  verifyPassword,
  hashPassword,
  createSessionToken,
  hashSessionToken,
  setSessionCookie,
  SESSION_DURATION
} from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Méthode non autorisée."
    });
  }

  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Veuillez renseigner votre e-mail et votre mot de passe."
      });
    }

    const sql = getDb();

    const admins = await sql`
      SELECT id, nom, email, mot_de_passe_hash, role, statut
      FROM administrateurs
      WHERE LOWER(email) = LOWER(${email.trim()})
      LIMIT 1
    `;

    if (admins.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Identifiants incorrects."
      });
    }

    const admin = admins[0];

    if (admin.statut !== "actif") {
      return res.status(401).json({
        success: false,
        message: "Identifiants incorrects ou compte inactif."
      });
    }

    const passwordIsValid = await verifyPassword(password, admin.mot_de_passe_hash);
    if (!passwordIsValid) {
      return res.status(401).json({
        success: false,
        message: "Identifiants incorrects ou compte inactif."
      });
    }

    // Migration transparente des anciens hashes vers 310 000 itérations.
    const hashIterations = Number(admin.mot_de_passe_hash.split("$")[1]);
    if (hashIterations < 310000) {
      const upgradedHash = await hashPassword(password);
      await sql`
        UPDATE administrateurs
        SET mot_de_passe_hash = ${upgradedHash}
        WHERE id = ${admin.id}
      `;
    }

    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiration = new Date(Date.now() + SESSION_DURATION * 1000);

    await sql`
      INSERT INTO sessions_admin (
        administrateur_id,
        jeton_hash,
        expiration
      )
      VALUES (
        ${admin.id},
        ${tokenHash},
        ${expiration.toISOString()}
      )
    `;

    setSessionCookie(res, token);

    return res.status(200).json({
      success: true,
      message: "Connexion réussie.",
      administrateur: {
        id: admin.id,
        nom: admin.nom,
        email: admin.email,
        role: admin.role
      }
    });

  } catch (error) {
    console.error("Erreur connexion administrateur:", error);

    return res.status(500).json({
      success: false,
      message: "Une erreur est survenue lors de la connexion."
    });
  }
}
