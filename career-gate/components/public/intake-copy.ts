import { OFFICE } from "@/lib/office";

/**
 * Every word the client-facing intake shows, in both languages.
 *
 * One page serves Arabic and English: there is no separate Arabic route. Arabic
 * is the default and renders right-to-left; English renders left-to-right.
 * Switching language never touches form state — the state lives above the
 * locale, so nothing the client typed is lost.
 */

export type IntakeLocale = "ar" | "en";

/** The office WhatsApp number from the existing office configuration. */
export const OFFICE_WHATSAPP_DIGITS = OFFICE.whatsapp.replace(/\D/g, "");
export const OFFICE_WHATSAPP_URL = `https://wa.me/1${OFFICE_WHATSAPP_DIGITS}`;

/** The existing client-safe status destination. */
export const CASE_STATUS_PATH = "/status";

export const INTAKE_COPY = {
  ar: {
    dir: "rtl" as const,
    brand: "بوابة التوظيف",
    office: "مكتب الهجرة للاستشارات وخدمات الهجرة والتوظيف",
    heading: "إدخال بيانات العميل",
    lead: "هذا الرابط مخصص لك لمرة واحدة. أكمل الخطوات التالية ثم اضغط إرسال.",

    guideTitle: "الموجّه الذكي",
    guideOpen: "فتح الموجّه الذكي",
    guideMinimize: "تصغير",
    guideWelcome:
      "مرحبًا بك. يرجى إدخال بياناتك ورفع الوثائق المطلوبة ثم الضغط على إرسال. سأرشدك خطوة بخطوة حتى يكتمل التقديم بشكل صحيح.",
    guideStart: "ابدأ بإدخال بياناتك الأساسية بدقة.",
    guideDocuments: "ارفع الوثائق المطلوبة بوضوح. يمكنك اختيار الملفات أو التصوير مباشرة إذا كان جهازك يدعم ذلك.",
    guideReview: "راجع المعلومات قبل الإرسال. بعد الإرسال لن يمكن استخدام هذا الرابط مرة أخرى.",
    guideReady: "بياناتك جاهزة. اضغط إرسال لإتمام التقديم.",
    guideIssue: "يرجى تصحيح الحقل المشار إليه ثم المتابعة.",
    guideSuccess: "تم استلام معلوماتك بنجاح. يمكنك الآن متابعة حالة الملف أو التواصل مع المكتب.",

    sourceHeading: "أدخل بياناتك هنا",
    sourceHelper: "أدخل أو الصق معلوماتك كما هي، وسيقوم النظام بقراءتها وتنظيمها تلقائيًا.",
    sourcePlaceholder: "الاسم الكامل\nرقم الهاتف\nالبريد الإلكتروني\nتاريخ الميلاد\nالعنوان، المدينة، الولاية، الرمز البريدي",

    detectedHeading: "راجع بياناتك",
    detectedHelper: "هذه هي المعلومات التي قرأها النظام. صحّح أي قيمة قبل الإرسال.",
    detectedEmpty: "ابدأ بإدخال بياناتك وستظهر هنا تلقائيًا.",
    groupIdentity: "الهوية",
    groupContact: "التواصل",
    groupAddress: "العنوان",
    groupLanguage: "اللغة",

    uploadHeading: "ارفع الوثائق هنا",
    uploadHelper: "ارفع صور أو ملفات الوثائق المطلوبة.",
    chooseFiles: "اختيار ملفات",
    takePhoto: "تصوير الوثائق",
    uploadFormats: "PDF أو JPG أو PNG أو WEBP · حتى 10 ملفات · 10 ميجابايت لكل ملف",
    filesHeading: "الوثائق المرفوعة",
    remove: "إزالة",
    replace: "استبدال",
    openPreview: "عرض",

    submit: "إرسال",
    submitting: "جارٍ الإرسال...",
    submitHelper: "املأ البيانات، ارفع الوثائق، راجع البيانات المستخرجة، ثم اضغط إرسال.",

    successHeading: "تم استلام معلوماتك بنجاح",
    successBody: "تم إرسال طلبك بنجاح. يمكنك الآن متابعة حالة الملف أو التواصل مع المكتب عند الحاجة.",
    successGuidance: "يمكنك متابعة حالة الملف من خلال زر حالة الملف.",
    successClosed: "تم إغلاق هذا الرابط بعد استخدامه بنجاح",
    caseStatus: "حالة الملف",
    whatsappOffice: "واتساب المكتب",

    closedHeading: "هذا الرابط مغلق",
    closedBody: "تم استخدام هذا الرابط أو انتهت صلاحيته. تواصل مع المكتب للحصول على رابط جديد.",
    invalidHeading: "رابط غير صالح",
    invalidBody: "تحقق من الرابط الذي استلمته، أو تواصل مع المكتب.",

    needSomething: "أدخل بياناتك أو ارفع وثيقة واحدة على الأقل.",
    fileTooLarge: "حجم الملف أكبر من الحد المسموح (10 ميجابايت).",
    tooManyFiles: "الحد الأقصى 10 ملفات.",
    totalTooLarge: "إجمالي حجم الملفات أكبر من الحد المسموح (25 ميجابايت).",
    unsupported: "نوع الملف غير مدعوم. المدعوم: PDF و JPG و PNG و WEBP.",
    genericError: "تعذر الإرسال. حاول مرة أخرى. بياناتك محفوظة.",
    invalidPhone: "أدخل رقم هاتف أمريكي صحيح من عشر أرقام.",
    invalidEmail: "أدخل بريدًا إلكترونيًا صحيحًا.",
    invalidZip: "أدخل رمزًا بريديًا صحيحًا.",
    invalidDate: "أدخل التاريخ بالصيغة YYYY-MM-DD.",

    fields: {
      full_name: "الاسم الكامل",
      phone: "رقم الهاتف",
      email: "البريد الإلكتروني",
      date_of_birth: "تاريخ الميلاد",
      street: "العنوان",
      city: "المدينة",
      state: "الولاية",
      zip: "الرمز البريدي",
      preferred_language: "اللغة المفضلة",
      english_proficiency: "مستوى الإنجليزية",
    },
  },
  en: {
    dir: "ltr" as const,
    brand: "Career Gate",
    office: "Immigration Consulting, Immigration & Employment Services",
    heading: "Client Intake",
    lead: "This link is for you and can be used once. Complete the steps below, then press Submit.",

    guideTitle: "Smart Guide",
    guideOpen: "Open Smart Guide",
    guideMinimize: "Minimize",
    guideWelcome:
      "Welcome. Please enter your information, upload the required documents, then press Submit. I will guide you step by step until your submission is complete.",
    guideStart: "Start by entering your basic information accurately.",
    guideDocuments: "Upload the required documents clearly. You can choose files or take a photo directly if your device supports it.",
    guideReview: "Review your information before submitting. After you submit, this link cannot be used again.",
    guideReady: "Your information is ready. Press Submit to complete your application.",
    guideIssue: "Please correct the field marked below, then continue.",
    guideSuccess: "Your information was received. You can now track your case or contact the office.",

    sourceHeading: "Enter your information here",
    sourceHelper: "Enter or paste your information and the system will organize it automatically.",
    sourcePlaceholder: "Full name\nPhone number\nEmail address\nDate of birth\nStreet, city, state, ZIP",

    detectedHeading: "Review your information",
    detectedHelper: "This is what the system read. Correct any value before submitting.",
    detectedEmpty: "Start entering your information and it will appear here automatically.",
    groupIdentity: "Identity",
    groupContact: "Contact",
    groupAddress: "Address",
    groupLanguage: "Language",

    uploadHeading: "Upload your documents here",
    uploadHelper: "Upload photos or document files.",
    chooseFiles: "Choose files",
    takePhoto: "Take a photo",
    uploadFormats: "PDF, JPG, PNG or WEBP · up to 10 files · 10 MB each",
    filesHeading: "Uploaded documents",
    remove: "Remove",
    replace: "Replace",
    openPreview: "View",

    submit: "Submit",
    submitting: "Submitting…",
    submitHelper: "Enter your information, upload documents, review the detected data, then press Submit.",

    successHeading: "Your information was submitted successfully.",
    successBody: "Your application was sent successfully. You can now track your case or contact the office if you need to.",
    successGuidance: "You can follow your case using the Case Status button.",
    successClosed: "This link has been closed after successful use.",
    caseStatus: "Case Status",
    whatsappOffice: "WhatsApp Office",

    closedHeading: "This link is closed",
    closedBody: "It has already been used or has expired. Contact the office for a new link.",
    invalidHeading: "Invalid link",
    invalidBody: "Check the link you received, or contact the office.",

    needSomething: "Enter your information or upload at least one document.",
    fileTooLarge: "That file is larger than the 10 MB limit.",
    tooManyFiles: "Up to 10 files.",
    totalTooLarge: "The files total more than the 25 MB limit.",
    unsupported: "That file type is not supported. Supported: PDF, JPG, PNG, WEBP.",
    genericError: "Your information could not be submitted. Please try again — nothing you entered was lost.",
    invalidPhone: "Enter a valid 10-digit US phone number.",
    invalidEmail: "Enter a valid email address.",
    invalidZip: "Enter a valid ZIP code.",
    invalidDate: "Enter the date as YYYY-MM-DD.",

    fields: {
      full_name: "Full name",
      phone: "Phone",
      email: "Email",
      date_of_birth: "Date of birth",
      street: "Street",
      city: "City",
      state: "State",
      zip: "ZIP",
      preferred_language: "Preferred language",
      english_proficiency: "English level",
    },
  },
} as const;

export type IntakeStrings = (typeof INTAKE_COPY)[IntakeLocale];
