/**
 * Appending to a PDF instead of rewriting it.
 *
 * A drawing in a job folder is somebody else's file: a consultant's issued
 * sheet, synced through SharePoint, often 40 MB. Writing REDBEAM's markups into
 * it by re-serializing the whole document (what `PDFDocument.save` does) would
 * re-encode every object, can change how other readers see the file, and makes
 * every save a full-file upload. An INCREMENTAL UPDATE (ISO 32000-1 §7.5.6)
 * leaves every original byte where it was and appends only the objects that
 * changed, a cross-reference section for them, and a trailer pointing back at
 * the previous one. Every PDF reader handles it, because it is how Acrobat
 * itself saves a signed or annotated file.
 *
 * pdf-lib parses and edits documents but only knows how to write a whole one,
 * so this is the missing half: given the original bytes, the edited document,
 * and which indirect objects changed, it writes the update section.
 *
 * The cross-reference FORM follows the original: a file whose last xref is a
 * stream gets a stream, a classic table gets a table. Mixing them is legal for
 * hybrid files only, and a reader that is strict about it is exactly the kind
 * that would then refuse the drawing.
 */
import {
  PDFCrossRefSection, PDFCrossRefStream, PDFName, PDFNumber, PDFRef,
  type PDFDict, type PDFDocument, type PDFObject,
} from 'pdf-lib'

const latin1 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

/** Offset of the cross-reference section the file's last `startxref` names. */
export function lastStartXref(bytes: Uint8Array): number {
  // The keyword sits in the last kilobyte or so; scanning backwards from the
  // end avoids decoding a 40 MB file to a string to find it.
  const needle = latin1('startxref')
  const from = Math.max(0, bytes.length - 4096)
  for (let i = bytes.length - needle.length; i >= from; i--) {
    let hit = true
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) { hit = false; break }
    }
    if (!hit) continue
    let k = i + needle.length
    while (k < bytes.length && (bytes[k] === 0x20 || bytes[k] === 0x0a || bytes[k] === 0x0d)) k++
    let n = 0
    let digits = 0
    while (k < bytes.length && bytes[k]! >= 0x30 && bytes[k]! <= 0x39) {
      n = n * 10 + (bytes[k]! - 0x30)
      k++
      digits++
    }
    if (digits === 0) break
    return n
  }
  throw new Error('This PDF has no startxref, so it cannot be appended to.')
}

/** Whether the section at `offset` is a classic `xref` table. */
export function isXrefTable(bytes: Uint8Array, offset: number): boolean {
  let k = offset
  while (k < bytes.length && (bytes[k] === 0x20 || bytes[k] === 0x0a || bytes[k] === 0x0d)) k++
  return bytes[k] === 0x78 && bytes[k + 1] === 0x72 && bytes[k + 2] === 0x65 && bytes[k + 3] === 0x66
}

function serialize(obj: PDFObject): Uint8Array {
  const buf = new Uint8Array(obj.sizeInBytes())
  obj.copyBytesInto(buf, 0)
  return buf
}

/**
 * The bytes of `original` followed by an update section holding `changed`.
 *
 * `doc` must have been loaded FROM `original`, so that its object numbers are
 * the file's own: a changed object is written under its existing number and
 * supersedes the earlier definition, and a new one under a number past the
 * old /Size.
 */
export function appendIncrementalUpdate(
  original: Uint8Array,
  doc: PDFDocument,
  changed: Iterable<PDFRef>,
): Uint8Array {
  const ctx = doc.context
  const prev = lastStartXref(original)
  const useTable = isXrefTable(original, prev)

  const refs = [...new Map([...changed].map((r) => [r.toString(), r])).values()]
    .filter((r) => ctx.lookup(r) !== undefined)
    .sort((a, b) => a.objectNumber - b.objectNumber)

  const chunks: Uint8Array[] = [original]
  let offset = original.length
  const push = (b: Uint8Array): void => { chunks.push(b); offset += b.length }

  // A file is not required to end in a newline, and `obj` glued to `%%EOF`
  // is not an object any reader will find.
  const last = original[original.length - 1]
  if (last !== 0x0a && last !== 0x0d) push(latin1('\n'))

  const offsets: Array<[PDFRef, number]> = []
  for (const ref of refs) {
    const obj = ctx.lookup(ref)!
    offsets.push([ref, offset])
    push(latin1(`${ref.objectNumber} ${ref.generationNumber} obj\n`))
    push(serialize(obj))
    push(latin1('\nendobj\n'))
  }

  const info = ctx.trailerInfo
  if (useTable) {
    const size = ctx.largestObjectNumber + 1
    const section = PDFCrossRefSection.createEmpty()
    for (const [ref, at] of offsets) section.addEntry(ref, at)
    const xrefAt = offset
    push(latin1(section.toString()))
    const trailer = ctx.obj({ Size: size, Prev: prev }) as PDFDict
    if (info.Root) trailer.set(PDFName.of('Root'), info.Root)
    if (info.Info) trailer.set(PDFName.of('Info'), info.Info)
    if (info.ID) trailer.set(PDFName.of('ID'), info.ID)
    if (info.Encrypt) trailer.set(PDFName.of('Encrypt'), info.Encrypt)
    push(latin1('trailer\n'))
    push(serialize(trailer))
    push(latin1(`\nstartxref\n${xrefAt}\n%%EOF\n`))
  } else {
    // The xref stream is itself an object and lists itself, so it takes the
    // next free number before /Size is computed.
    const streamRef = ctx.nextRef()
    const size = ctx.largestObjectNumber + 1
    const dict = ctx.obj({ Size: size, Prev: prev }) as PDFDict
    if (info.Root) dict.set(PDFName.of('Root'), info.Root)
    if (info.Info) dict.set(PDFName.of('Info'), info.Info)
    if (info.ID) dict.set(PDFName.of('ID'), info.ID)
    if (info.Encrypt) dict.set(PDFName.of('Encrypt'), info.Encrypt)
    // Not `PDFCrossRefStream.create`, which seeds the free-list head (object
    // 0): an update section lists only what it changes.
    const entries: Array<[PDFRef, number]> = [...offsets, [streamRef, offset] as [PDFRef, number]]
      .sort((a, b) => a[0].objectNumber - b[0].objectNumber)
    const fresh = PDFCrossRefStream.of(dict, [], true)
    for (const [ref, at] of entries) fresh.addUncompressedEntry(ref, at)
    dict.set(PDFName.of('Size'), PDFNumber.of(size))
    const xrefAt = offset
    push(latin1(`${streamRef.objectNumber} ${streamRef.generationNumber} obj\n`))
    push(serialize(fresh))
    push(latin1(`\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`))
  }

  const out = new Uint8Array(offset)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

/**
 * The file's own /Size, from its last trailer or cross-reference stream.
 *
 * pdf-lib counts only the objects it materialises, so for a file whose
 * objects live in object streams it does NOT count the object streams or the
 * xref stream themselves, and its next free number collides with one of them.
 * An update that reuses an object-stream's number replaces it, and every
 * object inside it vanishes (Revu: "Object reference not set to an instance
 * of an object"). The trailer's /Size is the authority on what is taken.
 */
export function trailerSize(bytes: Uint8Array): number {
  const from = Math.max(0, bytes.length - 65536)
  let text = ''
  for (let i = from; i < bytes.length; i++) text += String.fromCharCode(bytes[i]!)
  let size = 0
  for (const m of text.matchAll(/\/Size\s+(\d+)/g)) size = Math.max(size, Number(m[1]))
  return size
}

/**
 * Make sure every object number the file already uses is taken before any
 * new object is registered. Call straight after loading.
 */
export function reserveExistingNumbers(doc: PDFDocument, original: Uint8Array): number {
  const ctx = doc.context
  const largest = Math.max(ctx.largestObjectNumber, trailerSize(original) - 1)
  ctx.largestObjectNumber = largest
  return largest
}

/** Refs of indirect objects numbered past the original file's last one. */
export function newRefsSince(doc: PDFDocument, largestBefore: number): PDFRef[] {
  const out: PDFRef[] = []
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (ref.objectNumber > largestBefore) out.push(ref)
  }
  return out
}

export { PDFRef }
