import "server-only";
import { deflateRawSync } from "node:zlib";
import { dateOnly, dateTime } from "@/lib/format";
import type { OperationalClientRow } from "@/lib/operational-clients";

export function escapeRegistryXml(value: unknown) {
  const validXml=[...String(value??"")].filter(char=>{
    const code=char.codePointAt(0)!;
    return code===9||code===10||code===13||(code>=0x20&&code<=0xd7ff)||(code>=0xe000&&code<=0xfffd)||(code>=0x10000&&code<=0x10ffff);
  }).join("");
  return validXml.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

const HEADERS = ["Reference", "Client", "Phone", "Email", "City", "Current status", "Assigned specialist", "Site", "Shift", "Payment", "Start date", "Received", "Updated"];
export function registryExportValues(row: OperationalClientRow) {
  return [row.ref,row.full_name,row.phone,row.email,row.city,row.current_status,row.assigned_name,row.site_name,row.shift_name,row.payment_status,dateOnly(row.start_date),dateTime(row.created_at),dateTime(row.updated_at)];
}
function column(index:number) { let n=index+1,out="";while(n>0){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);}return out;}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: { name: string; content: string }[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.content, "utf8");
    const compressed = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}


/** Every untrusted value is an inline string: spreadsheet formula injection is impossible. */
export function buildRegistryWorkbook(rows: OperationalClientRow[]) {
  const xml=escapeRegistryXml;
  const body=[HEADERS,...rows.map(registryExportValues)].map((row,index)=>`<row r="${index+1}" ht="${index?24:30}" customHeight="1">${row.map((value,c)=>`<c r="${column(c)}${index+1}" t="inlineStr" s="${index===0?1:index%2?2:3}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join("")}</row>`).join("");
  const styles=`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><color rgb="FFE2E8F0"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFD4AF37"/><name val="Calibri"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0A1128"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF14223C"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1C2D47"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="hair"><color rgb="FFD4AF37"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" fillId="2" borderId="1" applyFill="1" applyBorder="1" applyFont="1"/><xf fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1" applyFont="1"/><xf fontId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1" applyFont="1"/></cellXfs></styleSheet>`;
  return zip([
    {name:"[Content_Types].xml",content:`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`},
    {name:"_rels/.rels",content:`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
    {name:"xl/workbook.xml",content:`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Career Gate Registry" sheetId="1" r:id="rId1"/></sheets></workbook>`},
    {name:"xl/_rels/workbook.xml.rels",content:`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
    {name:"xl/styles.xml",content:styles},
    {name:"xl/worksheets/sheet1.xml",content:`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="23" customWidth="1"/><col min="2" max="2" width="42" customWidth="1"/><col min="3" max="13" width="25" customWidth="1"/></cols><sheetData>${body}</sheetData><autoFilter ref="A1:M${rows.length+1}"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>`},
  ]);
}

/** Browser printing preserves Arabic text and lets the user choose PDF or their actual printer. */
export function buildRegistryPrint(rows: OperationalClientRow[], view:string, nonce:string, generatedAt:string) {
  const xml=escapeRegistryXml;
  return `<!DOCTYPE html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Career Gate — Client Registry</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{font:12px Arial,sans-serif;margin:32px;color:#132039;background:#f6f8fc}header{background:#0a1128;color:#e2e8f0;border-top:3px solid #d4af37;padding:22px;border-radius:12px}h1{font-size:25px;margin:0 0 8px;color:#d4af37}p{margin:6px 0}button{background:#00b4d8;border:0;color:#071327;font-weight:700;padding:12px 18px;border-radius:9px;cursor:pointer}table{border-collapse:collapse;width:100%;margin-top:20px;font-size:10px}th{background:#14223c;color:#fff;text-align:start;border-bottom:2px solid #d4af37;padding:10px 7px}td{border-bottom:1px solid #d4af3740;padding:9px 7px;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#eaf0f7}td:nth-child(2){min-width:140px;font-weight:700}footer{font-size:10px;margin-top:16px;color:#58657b}@page{size:A3 landscape;margin:12mm}@media print{body{margin:0;background:#fff}button{display:none}header,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}thead{display:table-header-group}tr{break-inside:avoid}}</style><header><h1>CAREER GATE</h1><p>Client Registry · ${xml(view)} · ${rows.length} file${rows.length===1?"":"s"}</p><p>Generated ${xml(dateTime(generatedAt))} · Authorized staff export</p><button id="print">Print / Save PDF</button></header><table><thead><tr>${HEADERS.map(label=>`<th>${label}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${registryExportValues(row).map(value=>`<td dir="auto">${xml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table><footer>One canonical client record throughout the workflow. Contains private client information.</footer><script nonce="${nonce}">document.getElementById('print').addEventListener('click',()=>window.print());window.addEventListener('load',()=>window.print());</script></html>`;
}
