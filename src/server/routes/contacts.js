const express = require("express");
const { cleanText, MAX_CONTACTS_PER_IMPORT, normalizeContactPayload, SUPPORTED_CONTACT_LANGUAGES } = require("../contacts");
const { getSupabaseAdmin, requireUser } = require("../supabase");

const router = express.Router();
const CONTACT_SELECT = "id,device_contact_id,display_name,given_name,family_name,company,phone_numbers,email_addresses,preferred_language,is_favorite,last_called_at,interpreter_user_id,created_at,updated_at";

router.use(requireUser);
router.use((req, res, next) => {
  if (req.interpreterUser.is_anonymous) {
    return res.status(403).json({ error: "A permanent account is required for contact synchronization" });
  }
  return next();
});

function serializeContact(row) {
  return {
    id: row.id,
    deviceContactId: row.device_contact_id,
    displayName: row.display_name,
    givenName: row.given_name,
    familyName: row.family_name,
    company: row.company,
    phoneNumbers: row.phone_numbers || [],
    emailAddresses: row.email_addresses || [],
    preferredLanguage: row.preferred_language,
    isFavorite: row.is_favorite,
    lastCalledAt: row.last_called_at,
    interpreterUserId: row.interpreter_user_id,
    isInterpreterUser: Boolean(row.interpreter_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function resolveInterpreterUsers(admin, contacts, ownerId) {
  const emailHashes = [...new Set(contacts.flatMap((contact) => contact.emailHashes))];
  const phoneHashes = [...new Set(contacts.flatMap((contact) => contact.phoneHashes))];
  const [emailResult, phoneResult] = await Promise.all([
    emailHashes.length
      ? admin.from("interpreter_user_directory").select("user_id,email_hash").in("email_hash", emailHashes)
      : Promise.resolve({ data: [], error: null }),
    phoneHashes.length
      ? admin.from("interpreter_user_directory").select("user_id,phone_hash").in("phone_hash", phoneHashes)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (emailResult.error || phoneResult.error) throw new Error("Unable to match Interpreter users");
  const emailMap = new Map((emailResult.data || []).map((item) => [item.email_hash, item.user_id]));
  const phoneCandidates = new Map();
  for (const item of phoneResult.data || []) {
    const users = phoneCandidates.get(item.phone_hash) || [];
    users.push(item.user_id);
    phoneCandidates.set(item.phone_hash, users);
  }
  return contacts.map((contact) => {
    const matchedByEmail = contact.emailHashes.map((hash) => emailMap.get(hash)).find(Boolean);
    const matchedByPhone = contact.phoneHashes
      .map((hash) => phoneCandidates.get(hash))
      .find((users) => users?.length === 1)?.[0];
    const match = matchedByEmail || matchedByPhone || null;
    return match === ownerId ? null : match;
  });
}

router.get("/", async (req, res) => {
  const admin = getSupabaseAdmin();
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 500, 1), 1000);
  const offset = Math.min(Math.max(Number.parseInt(req.query.offset, 10) || 0, 0), 100000);
  let query = admin.from("contacts").select(CONTACT_SELECT).eq("owner_id", req.interpreterUser.id);
  if (req.query.favorite === "true") query = query.eq("is_favorite", true);
  if (req.query.recent === "true") query = query.not("last_called_at", "is", null).order("last_called_at", { ascending: false });
  else query = query.order("display_name", { ascending: true });
  const search = cleanText(req.query.q, 100).replace(/[%_]/g, "");
  if (search) query = query.ilike("display_name", `%${search}%`);
  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) return res.status(500).json({ error: "Unable to load contacts" });
  return res.json({ contacts: (data || []).map(serializeContact), hasMore: (data || []).length === limit });
});

router.post("/import", async (req, res) => {
  if (!Array.isArray(req.body?.contacts) || req.body.contacts.length > MAX_CONTACTS_PER_IMPORT) {
    return res.status(400).json({ error: `Import between 1 and ${MAX_CONTACTS_PER_IMPORT} contacts at a time` });
  }
  const normalizedContacts = req.body.contacts.map(normalizeContactPayload).filter(Boolean);
  if (!normalizedContacts.length) return res.json({ imported: 0, contacts: [] });
  const admin = getSupabaseAdmin();
  try {
    const { data: tombstones, error: tombstoneError } = await admin.from("contact_tombstones").select("identity_hash")
      .eq("owner_id", req.interpreterUser.id).in("identity_hash", normalizedContacts.map((contact) => contact.identityHash));
    if (tombstoneError) throw tombstoneError;
    const deletedHashes = new Set((tombstones || []).map((item) => item.identity_hash));
    const contacts = normalizedContacts.filter((contact) => !deletedHashes.has(contact.identityHash));
    if (!contacts.length) return res.json({ imported: 0, contacts: [] });
    const identityHashes = contacts.map((contact) => contact.identityHash);
    const [existingResult, interpreterUsers] = await Promise.all([
      admin.from("contacts").select("identity_hash,device_contact_id,display_name,given_name,family_name,company,phone_numbers,email_addresses,preferred_language,is_favorite,last_called_at,interpreter_user_id,is_manually_edited").eq("owner_id", req.interpreterUser.id).in("identity_hash", identityHashes),
      resolveInterpreterUsers(admin, contacts, req.interpreterUser.id)
    ]);
    if (existingResult.error) throw new Error("Unable to inspect existing contacts");
    const existing = new Map((existingResult.data || []).map((item) => [item.identity_hash, item]));
    const rows = contacts.map((contact, index) => {
      const previous = existing.get(contact.identityHash);
      return {
        owner_id: req.interpreterUser.id,
        identity_hash: contact.identityHash,
        device_contact_id: contact.deviceContactId,
        display_name: previous?.is_manually_edited ? previous.display_name : contact.displayName,
        given_name: previous?.is_manually_edited ? previous.given_name : contact.givenName,
        family_name: previous?.is_manually_edited ? previous.family_name : contact.familyName,
        company: previous?.is_manually_edited ? previous.company : contact.company,
        phone_numbers: previous?.is_manually_edited ? previous.phone_numbers : contact.phoneNumbers,
        email_addresses: previous?.is_manually_edited ? previous.email_addresses : contact.emailAddresses,
        preferred_language: previous?.preferred_language || "English",
        is_favorite: previous?.is_favorite || false,
        last_called_at: previous?.last_called_at || null,
        interpreter_user_id: previous?.is_manually_edited ? previous.interpreter_user_id : interpreterUsers[index],
        is_manually_edited: previous?.is_manually_edited || false
      };
    });
    const { data, error } = await admin.from("contacts").upsert(rows, { onConflict: "owner_id,identity_hash" }).select(CONTACT_SELECT);
    if (error) throw error;
    return res.json({ imported: data?.length || 0, contacts: (data || []).map(serializeContact) });
  } catch {
    return res.status(500).json({ error: "Unable to import contacts" });
  }
});

router.delete("/", async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data: contacts, error: loadError } = await admin.from("contacts").select("identity_hash").eq("owner_id", req.interpreterUser.id);
  if (loadError) return res.status(500).json({ error: "Unable to delete imported contacts" });
  if (contacts?.length) {
    const { error: tombstoneError } = await admin.from("contact_tombstones").upsert(contacts.map((contact) => ({ owner_id: req.interpreterUser.id, identity_hash: contact.identity_hash })), { ignoreDuplicates: true, onConflict: "owner_id,identity_hash" });
    if (tombstoneError) return res.status(500).json({ error: "Unable to delete imported contacts" });
  }
  const { error } = await admin.from("contacts").delete().eq("owner_id", req.interpreterUser.id);
  if (error) return res.status(500).json({ error: "Unable to delete imported contacts" });
  return res.status(204).end();
});

router.get("/:contactId", async (req, res) => {
  const { data, error } = await getSupabaseAdmin().from("contacts").select(CONTACT_SELECT)
    .eq("id", req.params.contactId).eq("owner_id", req.interpreterUser.id).maybeSingle();
  if (error) return res.status(500).json({ error: "Unable to load contact" });
  if (!data) return res.status(404).json({ error: "Contact not found" });
  return res.json({ contact: serializeContact(data) });
});

router.patch("/:contactId", async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data: current, error: loadError } = await admin.from("contacts").select("*")
    .eq("id", req.params.contactId).eq("owner_id", req.interpreterUser.id).maybeSingle();
  if (loadError) return res.status(500).json({ error: "Unable to load contact" });
  if (!current) return res.status(404).json({ error: "Contact not found" });

  const merged = normalizeContactPayload({
    deviceContactId: current.device_contact_id,
    displayName: req.body?.displayName ?? current.display_name,
    givenName: req.body?.givenName ?? current.given_name,
    familyName: req.body?.familyName ?? current.family_name,
    company: req.body?.company ?? current.company,
    phoneNumbers: req.body?.phoneNumbers ?? current.phone_numbers,
    emailAddresses: req.body?.emailAddresses ?? current.email_addresses
  });
  if (!merged) return res.status(400).json({ error: "A contact name, phone, or email is required" });
  let interpreterUserId = current.interpreter_user_id;
  try {
    [interpreterUserId] = await resolveInterpreterUsers(admin, [merged], req.interpreterUser.id);
  } catch {
    return res.status(500).json({ error: "Unable to match Interpreter user" });
  }
  const updates = {
    display_name: merged.displayName,
    given_name: merged.givenName,
    family_name: merged.familyName,
    company: merged.company,
    phone_numbers: merged.phoneNumbers,
    email_addresses: merged.emailAddresses,
    interpreter_user_id: interpreterUserId,
    is_manually_edited: true
  };
  if (typeof req.body?.preferredLanguage === "string") {
    const preferredLanguage = cleanText(req.body.preferredLanguage, 80);
    if (!SUPPORTED_CONTACT_LANGUAGES.has(preferredLanguage)) return res.status(400).json({ error: "Unsupported preferred language" });
    updates.preferred_language = preferredLanguage;
  }
  if (typeof req.body?.isFavorite === "boolean") updates.is_favorite = req.body.isFavorite;
  if (req.body?.lastCalledAt === null) updates.last_called_at = null;
  else if (typeof req.body?.lastCalledAt === "string") {
    const calledAt = new Date(req.body.lastCalledAt);
    if (Number.isNaN(calledAt.getTime())) return res.status(400).json({ error: "Invalid call timestamp" });
    updates.last_called_at = calledAt.toISOString();
  }
  const { data, error } = await admin.from("contacts").update(updates).eq("id", current.id).eq("owner_id", req.interpreterUser.id).select(CONTACT_SELECT).single();
  if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "This contact already exists" : "Unable to update contact" });
  return res.json({ contact: serializeContact(data) });
});

router.delete("/:contactId", async (req, res) => {
  const admin = getSupabaseAdmin();
  const { data: contact, error: loadError } = await admin.from("contacts").select("id,identity_hash").eq("id", req.params.contactId)
    .eq("owner_id", req.interpreterUser.id).maybeSingle();
  if (loadError) return res.status(500).json({ error: "Unable to delete contact" });
  if (!contact) return res.status(404).json({ error: "Contact not found" });
  const { error: tombstoneError } = await admin.from("contact_tombstones").upsert({ owner_id: req.interpreterUser.id, identity_hash: contact.identity_hash }, { ignoreDuplicates: true, onConflict: "owner_id,identity_hash" });
  if (tombstoneError) return res.status(500).json({ error: "Unable to delete contact" });
  const { error } = await admin.from("contacts").delete().eq("id", contact.id).eq("owner_id", req.interpreterUser.id);
  if (error) return res.status(500).json({ error: "Unable to delete contact" });
  return res.status(204).end();
});

module.exports = router;
module.exports.resolveInterpreterUsers = resolveInterpreterUsers;
module.exports.serializeContact = serializeContact;
