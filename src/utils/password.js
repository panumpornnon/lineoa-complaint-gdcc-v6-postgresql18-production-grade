// เกณฑ์ความแข็งแรงของรหัสผ่าน ใช้ร่วมกันทั้งฝั่งเซิร์ฟเวอร์และฝั่งหน้าเว็บ
//
// ฝั่งหน้าเว็บตรวจเพื่อบอกผู้ใช้ทันทีว่ายังขาดอะไร ส่วนฝั่งเซิร์ฟเวอร์ตรวจซ้ำเสมอ
// เพราะการตรวจที่หน้าเว็บอย่างเดียวข้ามได้ด้วยการยิงคำขอตรง
export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_RULES = [
  { key: 'length', label: `ยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`, test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { key: 'upper', label: 'มีตัวอักษรภาษาอังกฤษพิมพ์ใหญ่ A-Z', test: (v) => /[A-Z]/.test(v) },
  { key: 'lower', label: 'มีตัวอักษรภาษาอังกฤษพิมพ์เล็ก a-z', test: (v) => /[a-z]/.test(v) },
  { key: 'digit', label: 'มีตัวเลข 0-9', test: (v) => /\d/.test(v) },
  { key: 'special', label: 'มีอักขระพิเศษ เช่น ! @ # $ %', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

// คืนรายการเกณฑ์ที่ยังไม่ผ่าน ถ้าว่างแปลว่าผ่านครบ
export function checkPasswordStrength(password) {
  const value = String(password ?? '');
  return PASSWORD_RULES.filter((rule) => !rule.test(value));
}

export function describePasswordRequirements(failed) {
  return `รหัสผ่านต้อง${failed.map((rule) => rule.label).join(' และ ')}`;
}
