# v2.3 — إجراء النشر والتراجع (الترحيلان 0034 و0035)

## قبل النشر
1. لقطة: `wrangler d1 export alhijrah-canada-db --remote --output backups/prod-<TS>.sql` ثم التحقق بالاستعادة محليًا ومقارنة عدد صفوف كل جدول بالإنتاج.
2. تسجيل علامة الاسترجاع: `wrangler d1 time-travel info alhijrah-canada-db`.

## النشر
1. `node scripts/run-framework.mjs build` ثم `node scripts/deploy-config.mjs`.
2. `wrangler d1 migrations apply alhijrah-canada-db --remote --config dist/server/wrangler.deploy.json`.
3. `wrangler deploy --config dist/server/wrangler.deploy.json`.
4. استيراد كتالوج NOC: `node scripts/noc-import.mjs --url https://<desk> --header 'cookie: <جلسة مدير>'` (48 طلبًا: بداية + 42 دفعة عقد + 4 دفعات ربط + تفعيل).

## التراجع
- **تراجع المخطط:** `wrangler d1 execute alhijrah-canada-db --remote --file drizzle/rollback/0034_0035_rollback.sql`.
  الترحيلان إضافيان بالكامل، والتراجع يعيد المخطط إلى ما قبلهما بالضبط (مجرّب على نسخة من الإنتاج: 48 كائنًا تُضاف ثم تُزال، وعدد صفوف كل جدول قائم لا يتغير). يُتلف ما أُنشئ بعد النشر: نسخ التقييم، الإجابات، الإجراءات، قراءات المرفقات، ولقطة NOC.
- **تراجع الكود:** `wrangler rollback --config dist/server/wrangler.deploy.json` أو نشر الإصدار السابق.
- **تراجع البيانات:** `wrangler d1 time-travel restore alhijrah-canada-db --bookmark=<العلامة المسجلة قبل النشر>`.

## الترتيب عند حادث حرج
1. `wrangler rollback` أولًا (أسرع، ويعيد السلوك السابق مع بقاء الجداول الجديدة غير مستخدمة).
2. إن كان الخلل في المخطط أو البيانات: نفّذ ملف التراجع، أو استرجع بالعلامة الزمنية.
