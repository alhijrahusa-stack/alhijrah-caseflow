import path from 'node:path';
import { createRequire } from 'node:module';
import { parse, states } from 'mrz';

const require = createRequire(import.meta.url);
const languageRoot = path.join(path.dirname(require.resolve('@tesseract.js-data/eng')), '4.0.0_best_int');

let workerStatePromise;
let ocrQueue = Promise.resolve();

async function workerState() {
  if (!workerStatePromise) {
    workerStatePromise = (async () => {
      const module = await import('tesseract.js');
      const api = module.default || module;
      const worker = await api.createWorker('eng', 1, {
        langPath: languageRoot,
        cachePath: '/tmp',
        cacheMethod: 'write',
        gzip: true,
      });
      return { worker, PSM: api.PSM };
    })().catch(error => {
      workerStatePromise = null;
      throw error;
    });
  }
  return workerStatePromise;
}

function normalizeMrzText(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[«‹〈《]/g, '<')
    .replace(/[^A-Z0-9<\n\r ]/g, ' ');
}

function lineVariants(value) {
  const clean = normalizeMrzText(value).trim();
  if (!clean) return [];
  return [...new Set([
    clean.replace(/\s+/g, ''),
    clean.replace(/ +/g, '<').replace(/\s+/g, ''),
  ])];
}

function parseScore(result) {
  if (!result) return -1;
  const validFields = result.details?.filter(detail => detail.field && detail.valid).length || 0;
  return (result.valid ? 1000 : 0) + validFields;
}

function parseCandidate(lines, autocorrect) {
  try {
    return parse(lines, { autocorrect });
  } catch {
    return null;
  }
}

export function parseMrzFromText(text) {
  const rawLines = normalizeMrzText(text).split(/\r?\n/).flatMap(lineVariants);
  const candidates = [];
  const formats = [
    { count: 2, length: 44 },
    { count: 3, length: 30 },
    { count: 2, length: 36 },
  ];
  for (const format of formats) {
    const lines = rawLines.filter(line => line.length === format.length);
    for (let index = 0; index <= lines.length - format.count; index += 1) {
      candidates.push(lines.slice(index, index + format.count));
    }
  }

  const flattened = rawLines.join('');
  for (const format of formats) {
    const total = format.count * format.length;
    for (const marker of format.length === 44 ? ['P<'] : ['I<', 'A<', 'C<']) {
      let start = flattened.indexOf(marker);
      while (start >= 0) {
        const section = flattened.slice(start, start + total);
        if (section.length === total) {
          candidates.push(Array.from({ length: format.count }, (_, index) => section.slice(index * format.length, (index + 1) * format.length)));
        }
        start = flattened.indexOf(marker, start + 1);
      }
    }
  }

  let best = null;
  for (const lines of candidates) {
    const result = parseCandidate(lines, false);
    const correctedResult = result?.valid ? null : parseCandidate(lines, true);
    const score = parseScore(result) + (correctedResult?.valid ? 100 : 0);
    if (!best || score > best.score) {
      best = {
        lines,
        result,
        corrected_result: correctedResult?.valid ? correctedResult : null,
        correction_required: Boolean(!result?.valid && correctedResult?.valid),
        score,
      };
    }
  }
  return best;
}

function mrzDate(value, kind) {
  if (!/^\d{6}$/.test(String(value || ''))) return null;
  const yy = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const current = new Date().getUTCFullYear();
  let year;
  if (kind === 'birth') {
    const thisCentury = 2000 + yy;
    year = thisCentury <= current ? thisCentury : 1900 + yy;
  } else {
    year = 2000 + yy;
    if (year < current - 20) year += 100;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fieldsFromResult(result) {
  if (!result) return {};
  const fields = result.fields || {};
  const legalName = [fields.firstName, fields.lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const stateName = states[fields.issuingState] || fields.issuingState || null;
  const nationality = states[fields.nationality] || fields.nationality || null;
  return {
    legal_name: legalName || null,
    date_of_birth: mrzDate(fields.birthDate, 'birth'),
    nationality,
    passport_number: result.documentNumber || fields.documentNumber || null,
    passport_country: stateName,
    passport_expiration: mrzDate(fields.expirationDate, 'expiration'),
    sex: fields.sex || null,
  };
}

function fieldsFromMrz(best) {
  if (!best?.result?.valid) return {};
  return fieldsFromResult(best.result);
}

function visualFallback(text) {
  const passport = String(text || '').match(/(?:passport|document)\s*(?:no\.?|number|n[oº])?\s*[:#-]?\s*([A-Z0-9]{6,12})/i)?.[1] || null;
  return { passport_number: passport };
}

async function runRecognition(imageBuffer) {
  const sharp = (await import('sharp')).default;
  const normalized = await sharp(imageBuffer, { failOn: 'error', limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: false })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer({ resolveWithObject: true });
  const cropTop = Math.floor(normalized.info.height * 0.48);
  const mrzImage = await sharp(normalized.data)
    .extract({ left: 0, top: cropTop, width: normalized.info.width, height: normalized.info.height - cropTop })
    .resize({ width: 2800, withoutEnlargement: false })
    .normalize()
    .sharpen()
    .png()
    .toBuffer();

  const { worker, PSM } = await workerState();
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    tessedit_char_whitelist: '',
    preserve_interword_spaces: '1',
  });
  const full = await worker.recognize(normalized.data);
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
    preserve_interword_spaces: '1',
  });
  const mrz = await worker.recognize(mrzImage);
  const combinedText = `${mrz.data.text || ''}\n${full.data.text || ''}`;
  const best = parseMrzFromText(combinedText);
  const extracted = { ...visualFallback(full.data.text), ...fieldsFromMrz(best) };
  for (const [key, value] of Object.entries(extracted)) if (value === null || value === '') delete extracted[key];
  const correctedFields = best?.corrected_result ? fieldsFromResult(best.corrected_result) : null;
  if (correctedFields) {
    for (const [key, value] of Object.entries(correctedFields)) if (value === null || value === '') delete correctedFields[key];
  }
  return {
    engine: 'tesseract.js',
    confidence: Math.round(Number(full.data.confidence || 0) * 10) / 10,
    mrz: best ? {
      detected: true,
      valid: Boolean(best.result?.valid),
      format: best.result?.format || best.corrected_result?.format || null,
      lines: best.lines,
      invalid_fields: best.result?.details?.filter(detail => detail.field && !detail.valid).map(detail => detail.field) || [],
      correction_required: best.correction_required,
      correction_candidate: best.corrected_result ? {
        valid: true,
        format: best.corrected_result.format || null,
        fields: correctedFields || {},
      } : null,
    } : { detected: false, valid: false, format: null, lines: [], invalid_fields: [], correction_required: false, correction_candidate: null },
    fields: extracted,
    raw_text: String(full.data.text || '').trim().slice(0, 4000),
  };
}

export function extractIdentityDocument(imageBuffer) {
  const job = ocrQueue.then(() => runRecognition(imageBuffer));
  ocrQueue = job.catch(() => {});
  return job;
}

export async function shutdownIdentityOcr() {
  if (!workerStatePromise) return;
  const { worker } = await workerStatePromise;
  await worker.terminate();
  workerStatePromise = null;
}
