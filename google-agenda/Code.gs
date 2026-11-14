/**
 * Menus de la famille → Google Agenda
 * Recopie les repas du site dans l'agenda « Repas » toutes les 5 minutes.
 *
 * Installation : coller ce fichier dans script.google.com, remplir CODE_FAMILLE,
 * puis lancer une fois la fonction « installer ».
 */
const CODE_FAMILLE = "COLLEZ_ICI_LE_CODE_FAMILLE";
const NOM_AGENDA = "Repas";
const SB_URL = "https://dqyobjaspxdfhjlqnrrc.supabase.co";
const SB_KEY = "sb_publishable_y0PIDa5WMNb-K0AcDaL8Ag_jKaPYiuW";
const JOURS_AVANT = 14;    // repas passés gardés à jour
const JOURS_APRES = 120;   // repas à venir envoyés
const TAG = "menusFamille";

/** À lancer une seule fois : crée l'agenda, la synchronisation automatique, et fait un premier envoi. */
function installer() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "synchroniser")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("synchroniser").timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().deleteProperty("empreinte");
  synchroniser();
  Logger.log("✓ Installé : l'agenda « " + NOM_AGENDA + " » sera mis à jour toutes les 5 minutes.");
}

/** Pour tout arrêter (l'agenda et ses repas restent). */
function desinstaller() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log("Synchronisation arrêtée.");
}

function agenda_() {
  const l = CalendarApp.getCalendarsByName(NOM_AGENDA).filter(c => c.isOwnedByMe());
  if (l.length) return l[0];
  const c = CalendarApp.createCalendar(NOM_AGENDA, { color: CalendarApp.Color.ORANGE, timeZone: "Europe/Paris" });
  c.setDescription("Repas du site Menus de la famille (mis à jour automatiquement)");
  return c;
}

function lireSite_() {
  const r = UrlFetchApp.fetch(SB_URL + "/rest/v1/rpc/menus_get", {
    method: "post",
    contentType: "application/json",
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
    payload: JSON.stringify({ p_code: CODE_FAMILLE }),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error("Site injoignable (" + r.getResponseCode() + ")");
  const d = JSON.parse(r.getContentText());
  if (!d) throw new Error("Code famille inconnu : vérifiez CODE_FAMILLE");
  return d;
}

function synchroniser() {
  const d = lireSite_();
  const h = (d.settings && d.settings.midi) || "12:00";
  const s = (d.settings && d.settings.soir) || "19:30";
  const heures = { midi: h, soir: s };
  const tz = "Europe/Paris";
  const debut = new Date(); debut.setHours(0, 0, 0, 0); debut.setDate(debut.getDate() - JOURS_AVANT);
  const fin = new Date(debut); fin.setDate(fin.getDate() + JOURS_AVANT + JOURS_APRES + 1);
  const kDebut = Utilities.formatDate(debut, tz, "yyyy-MM-dd"), kFin = Utilities.formatDate(fin, tz, "yyyy-MM-dd");

  // repas voulus
  const voulus = {};
  const plan = d.plan || {};
  Object.keys(plan).forEach(k => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || k < kDebut || k >= kFin) return;
    ["midi", "soir"].forEach(slot => {
      const r = plan[k][slot];
      if (!r || (!r.plat && !r.note)) return;
      voulus[k + "_" + slot] = {
        titre: (slot === "midi" ? "☀️ Midi : " : "🌙 Soir : ") + (r.plat || r.note),
        desc: [r.note ? "📝 " + r.note : "", "— Menus de la famille"].filter(String).join("\n"),
        debut: Utilities.parseDate(k + " " + heures[slot], tz, "yyyy-MM-dd HH:mm"),
      };
    });
  });

  // rien n'a changé depuis le dernier passage ? on s'arrête là
  const props = PropertiesService.getScriptProperties();
  const empreinte = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify([voulus, kDebut])));
  if (props.getProperty("empreinte") === empreinte) return;

  const cal = agenda_();
  const existants = {};
  cal.getEvents(debut, fin).forEach(ev => {
    const k = ev.getTag(TAG);
    if (!k) return;
    if (existants[k]) { ev.deleteEvent(); return; } // doublon
    existants[k] = ev;
  });

  let ajoutes = 0, modifies = 0, supprimes = 0;
  Object.keys(voulus).forEach(k => {
    const v = voulus[k], fin1h = new Date(v.debut.getTime() + 60 * 60 * 1000);
    const ev = existants[k];
    if (!ev) {
      const n = cal.createEvent(v.titre, v.debut, fin1h, { description: v.desc });
      n.setTag(TAG, k); n.setTransparency(CalendarApp.EventTransparency.TRANSPARENT); n.removeAllReminders();
      ajoutes++;
    } else {
      let chg = false;
      if (ev.getTitle() !== v.titre) { ev.setTitle(v.titre); chg = true; }
      if (ev.getDescription() !== v.desc) { ev.setDescription(v.desc); chg = true; }
      if (ev.getStartTime().getTime() !== v.debut.getTime()) { ev.setTime(v.debut, fin1h); chg = true; }
      if (chg) modifies++;
    }
  });
  Object.keys(existants).forEach(k => { if (!voulus[k]) { existants[k].deleteEvent(); supprimes++; } });

  props.setProperty("empreinte", empreinte);
  Logger.log("Repas : " + ajoutes + " ajouté(s), " + modifies + " modifié(s), " + supprimes + " supprimé(s).");
}
