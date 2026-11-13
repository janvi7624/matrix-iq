// The confidentiality notice carried by Marketing Material documents.
//
// One module so the wording exists in exactly one place: the footer stamped
// into served PDFs, the banner on the internal library, and the banner on the
// Partner Portal all read from here. A notice that says two different things
// in two places is worse than no notice, because it invites an argument about
// which one applies.

/**
 * The full legal line, used wherever there is room for it — the stamped PDF
 * footer and the library banners.
 *
 * Wording is the client's own, with "Nanta Tech Limited" named in full rather
 * than shortened: this line is the part that would be read back in a dispute,
 * so the entity has to be unambiguous.
 */
export const MATERIAL_CONFIDENTIALITY_NOTICE =
  'Confidential – Not for distribution without prior written consent of Nanta Tech Limited.';

/**
 * The short form, for a card caption or a tooltip where the full sentence
 * would wrap badly. Never used on its own in a stamped document — a document
 * that leaves the building carries the full line.
 */
export const MATERIAL_CONFIDENTIALITY_SHORT = 'Confidential – not for distribution';

/**
 * Line added beneath the notice on documents shared OUTSIDE the company.
 *
 * Partners receive the same documents through the Partner Portal, and the
 * footer is the only thing that still travels with a file once it has been
 * downloaded and forwarded. Naming the recipient is what makes a leaked copy
 * traceable to the account that pulled it; the notice alone is not.
 */
export function recipientLine(recipient: string, servedOn: Date): string {
  const stamp = servedOn.toISOString().slice(0, 10);
  return recipient ? `Issued to ${recipient} on ${stamp}` : `Issued on ${stamp}`;
}
