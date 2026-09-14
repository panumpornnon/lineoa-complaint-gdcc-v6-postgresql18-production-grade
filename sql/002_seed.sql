INSERT INTO complaint_categories (code, name_th, sort_order) VALUES
  ('ROAD', 'ถนน ทางเท้า และโครงสร้างพื้นฐาน', 10),
  ('LIGHT', 'ไฟฟ้าส่องสว่าง', 20),
  ('WASTE', 'ขยะและความสะอาด', 30),
  ('DRAIN', 'ท่อระบายน้ำและน้ำท่วม', 40),
  ('PUBLIC_HEALTH', 'เหตุรำคาญและสาธารณสุข', 50),
  ('TRAFFIC', 'การจราจรและความปลอดภัย', 60),
  ('ENVIRONMENT', 'สิ่งแวดล้อม', 70),
  ('OTHER', 'เรื่องอื่น ๆ', 100)
ON CONFLICT (code) DO NOTHING;
