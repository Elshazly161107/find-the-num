# 1. تحديد بيئة Node.js
FROM node:18-alpine

# 2. تحديد مجلد العمل
WORKDIR /app

# 3. نسخ ملفات الإعدادات وتثبيت المكتبات
COPY package*.json ./
RUN npm install

# 4. نسخ باقي ملفات المشروع
COPY . .

# 5. فتح البورت
EXPOSE 3000

# 6. أمر تشغيل السيرفر
CMD ["node", "server.js"]