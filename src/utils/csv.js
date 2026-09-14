export function escapeCsvField(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

// Excel otherwise infers phone numbers as numeric values when opening a CSV.
export function toExcelText(value) {
  return `="${String(value ?? '').replaceAll('"', '""')}"`;
}

// แปลงข้อความ CSV เป็นอาร์เรย์ของแถว ตามมาตรฐาน RFC 4180
// รองรับค่าที่ครอบด้วยเครื่องหมายคำพูด และการ escape ด้วยการพิมพ์ซ้ำสองครั้ง
// ตัด BOM ที่ Excel ใส่มาให้อัตโนมัติ และข้ามแถวที่ว่างทั้งแถว
export function parseCsv(text) {
  const input = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  while (index < input.length) {
    const ch = input[index];

    if (inQuotes) {
      if (ch === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += ch;
      index += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (ch === '\r') {
      index += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
      continue;
    }

    field += ch;
    index += 1;
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

// ถอดปลอกที่ toExcelText ใส่ไว้ ="0812345678" กลับเป็น 0812345678
// ใช้ตอนนำเข้าไฟล์ที่ส่งออกจากระบบนี้เอง
export function unwrapExcelText(value) {
  const text = String(value ?? '').trim();
  const match = /^="(.*)"$/s.exec(text);
  return match ? match[1].replaceAll('""', '"') : text;
}
