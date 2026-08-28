      const $ = (id) => document.getElementById(id);
      let currentUser = null,
        currentLanguage = "English",
        cases = [],
        docs = [],
        clients = [],
        tasks = [],
        alerts = [],
        services = [],
        portalData = null,
        portalUploadTarget = null,
        selectedDocumentFile = null,
        invoices = [],
        teamUsers = [],
        intakeState = null,
        intakeSaveTimer = null,
        inviteAccessToken = null,
        identityExtractionToken = null,
        selectedImportId = null,
        importPollTimer = null;
      if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
      const translations = Object.freeze({
        ar: {
          dashboard:"لوحة العمليات",cases:"الملفات",clients:"العملاء",documents:"المستندات",services:"الخدمات",tasks:"المهام",reviewQueue:"قائمة المراجعة",billing:"الفوترة",reports:"التقارير",teamRoles:"الفريق والصلاحيات",auditTrail:"سجل التدقيق",accessControl:"إدارة الوصول",settings:"الإعدادات",newCase:"ملف جديد",signOut:"تسجيل الخروج",english:"English",arabic:"العربية",operationsConsole:"مركز العمليات",caseManagementDashboard:"لوحة إدارة الملفات",totalCases:"إجمالي الملفات",intakeQueue:"قائمة الاستقبال",awaitingDocuments:"بانتظار المستندات",readyToFile:"جاهز للتقديم",filedReceipted:"مُقدَّم / تم استلام الإشعار",overdueTasks:"مهام متأخرة",highPriority:"أولوية عالية",recentCases:"أحدث الملفات",quickActions:"إجراءات سريعة",refresh:"تحديث",searchCases:"ابحث برقم الملف أو اسم العميل أو رقم الإيصال",searchClients:"ابحث برقم العميل أو الاسم أو الجواز أو A-Number أو الهاتف أو البريد",client:"العميل",clientNumber:"رقم العميل",caseNumber:"رقم الملف",caseType:"نوع الخدمة",status:"الحالة",priority:"الأولوية",assigned:"الموظف المسؤول",created:"تاريخ الإنشاء",open:"فتح",caseWorkspace:"مساحة عمل الملف",overview:"نظرة عامة",caseJourney:"مسار الملف",clientProfile:"ملف العميل",intake:"بيانات الاستقبال",requiredActions:"الإجراءات المطلوبة",deadlines:"المواعيد النهائية",appointments:"المواعيد",communications:"المراسلات",internalNotes:"الملاحظات الداخلية",teamHub:"فريق الملف",activityAudit:"النشاط والتدقيق",latestActivity:"آخر نشاط",nextDeadline:"أقرب موعد نهائي",outstandingBalance:"الرصيد المستحق",service:"الخدمة",workflowStage:"مرحلة سير العمل",noRecords:"لا توجد سجلات.",workspaceSettings:"إعدادات مساحة العمل",officeBrand:"هوية المكتب",officeName:"اسم المكتب",officeEmail:"البريد الإلكتروني",officePhone:"الهاتف",officeWhatsapp:"واتساب",officeAddress:"العنوان",defaultLanguage:"اللغة الافتراضية",emailFooterEnglish:"تذييل البريد بالإنجليزية",emailFooterArabic:"تذييل البريد بالعربية",saveSettings:"حفظ الإعدادات",staffProfile:"الملف الشخصي للموظف",displayName:"الاسم الظاهر",preferredLanguage:"اللغة المفضلة",saveProfile:"حفظ الملف الشخصي",officeLogo:"شعار المكتب",uploadLogo:"رفع الشعار",securePortal:"بوابة العميل الآمنة",yourCases:"ملفاتكم",requestedDocuments:"المستندات المطلوبة",currentStatus:"الحالة الحالية",sendMessage:"إرسال رسالة",close:"إغلاق",loading:"جارٍ التحميل…",save:"حفظ",cancel:"إلغاء",edit:"تعديل"
        }
      });
      Object.assign(translations.ar,{importCenter:"مركز الاستيراد",bulkImport:"استيراد العملاء والملفات بالجملة",importSafety:"تبقى الملفات في منطقة تجهيز محمية إلى أن يعتمد شخص نتيجة التشغيل التجريبي.",dropSpreadsheet:"أفلت ملف XLSX أو CSV بترميز UTF-8 هنا",browseSpreadsheet:"أو اختر جدولًا · 25 ميغابايت كحد أقصى · 10,000 صف",stagedImports:"عمليات الاستيراد المجهزة",importWorkflow:"اربط الحقول وتحقق وراجع واعتمد، ثم نفّذ في الخلفية.",filename:"اسم الملف",rows:"الصفوف",progress:"التقدم",humanReview:"المراجعة البشرية",dryRun:"تشغيل تجريبي",approveImport:"اعتماد الاستيراد",startImport:"بدء الاستيراد",sourceRow:"صف المصدر",duplicateDecision:"قرار التكرار",validation:"التحقق",approve:"اعتماد",skip:"تخطي",correct:"تصحيح",assignStaff:"تعيين موظف",mapService:"ربط الخدمة",merge:"دمج",csvReport:"تقرير CSV",xlsxReport:"تقرير XLSX",saveMapping:"حفظ الربط",valid:"صالح",invalid:"بحاجة للمراجعة",possible:"تكرار محتمل",new:"جديد",existing:"قائم",total:"الإجمالي",yourProtectedWorkspace:"مساحتكم الآمنة",caseStatusNextActions:"حالة الملف والإجراءات التالية",currentOfficeWorkflow:"حالة سير العمل لدى المكتب",uploadCorrectRequest:"ارفع المستند مباشرة إلى الطلب الصحيح",yourDocuments:"مستنداتكم",secureDocumentHistory:"سجل الرفع والمراجعة الآمن",authorizedBilling:"الفوترة المصرح بها",visibleInvoicesOnly:"الفواتير التي أتاحها المكتب لحسابكم فقط",upcomingScheduledEvents:"المواعيد المجدولة القادمة",clientVisibleDeadlines:"المواعيد التي أتاحها فريق الملف",notifications:"الإشعارات",caseAlerts:"تنبيهات الملف والإجراءات المطلوبة",profile:"الملف الشخصي",protectedClientRecord:"سجل العميل المحمي",secureStorageNotice:"تُرسل المستندات عبر تخزين آمن. لا ترسل كلمات مرور الحسابات الحكومية.",download:"عرض وتنزيل",agency:"الجهة",receiptNumber:"رقم الإيصال",updates:"التحديثات",approvedCommunications:"المراسلات المعتمدة",amount:"المبلغ",dueDate:"تاريخ الاستحقاق",locationPending:"سيتم تزويدكم بالموقع",noAppointments:"لا توجد مواعيد قادمة.",noRequestedDocuments:"لا توجد مستندات مطلوبة حاليًا.",noDocuments:"لا توجد مستندات متاحة.",noDeadlines:"لا توجد مواعيد نهائية متاحة.",noNotifications:"لا توجد إشعارات حالية.",noBilling:"لا توجد فواتير متاحة.",uploadDocument:"رفع مستند",pending:"قيد الانتظار",notAssigned:"غير محدد",notReceived:"لم يُستلم",messageRequired:"أدخل رسالة.",secureMessage:"إرسال رسالة آمنة",clientOnly:"للعميل فقط"});
      Object.assign(translations.ar,{case:"الملف",email:"البريد الإلكتروني",phone:"الهاتف"});
      const tr = (key) => currentLanguage === "Arabic" ? (translations.ar[key] || key) : ({
        reviewQueue:"Review Queue",teamRoles:"Team & Roles",auditTrail:"Audit Trail",accessControl:"Access Control",newCase:"New Case",signOut:"Sign Out",operationsConsole:"Operations Console",caseManagementDashboard:"Case Management Dashboard",totalCases:"Total Cases",intakeQueue:"Intake Queue",awaitingDocuments:"Awaiting Documents",readyToFile:"Ready to File",filedReceipted:"Filed / Receipted",overdueTasks:"Overdue Tasks",highPriority:"High Priority",recentCases:"Recent Cases",quickActions:"Quick Actions",searchCases:"Search Case Number, client, receipt or service",searchClients:"Search Client Number, name, passport, A-Number, phone or email",clientNumber:"Client Number",caseNumber:"Case Number",caseType:"Case Type",caseWorkspace:"Case Workspace",caseJourney:"Case Journey",clientProfile:"Client Profile",requiredActions:"Required Actions",internalNotes:"Internal Notes",teamHub:"Team Hub",activityAudit:"Activity / Audit",latestActivity:"Latest Activity",nextDeadline:"Next Deadline",outstandingBalance:"Outstanding Balance",workflowStage:"Workflow Stage",noRecords:"No records.",workspaceSettings:"Workspace Settings",officeBrand:"Office Brand",officeName:"Office Name",officeEmail:"Office Email",officePhone:"Office Phone",officeWhatsapp:"WhatsApp",officeAddress:"Office Address",defaultLanguage:"Default Language",emailFooterEnglish:"English Email Footer",emailFooterArabic:"Arabic Email Footer",saveSettings:"Save Settings",staffProfile:"Staff Profile",displayName:"Display Name",preferredLanguage:"Preferred Language",saveProfile:"Save Profile",officeLogo:"Office Logo",uploadLogo:"Upload Logo",securePortal:"Secure Client Portal",yourCases:"Your Cases",requestedDocuments:"Requested Documents",currentStatus:"Current Status",sendMessage:"Send Message",yourProtectedWorkspace:"Your protected workspace",caseStatusNextActions:"Case status and next actions",currentOfficeWorkflow:"Current office workflow status",uploadCorrectRequest:"Upload directly to the correct request",yourDocuments:"Your Documents",secureDocumentHistory:"Secure upload and review history",authorizedBilling:"Authorized Billing",visibleInvoicesOnly:"Only invoices released to your account",upcomingScheduledEvents:"Upcoming scheduled events",clientVisibleDeadlines:"Dates released by your case team",notifications:"Notifications",caseAlerts:"Case alerts and required attention",profile:"Profile",protectedClientRecord:"Protected client record",secureStorageNotice:"Documents are sent through secure storage. Do not send passwords for government accounts.",download:"View / Download",agency:"Agency",receiptNumber:"Receipt number",updates:"Updates",approvedCommunications:"Approved communications",amount:"Amount",dueDate:"Due date",locationPending:"Location will be provided",noAppointments:"No upcoming appointments.",noRequestedDocuments:"No documents are currently requested.",noDocuments:"No documents are available.",noDeadlines:"No deadlines are available.",noNotifications:"No current notifications.",noBilling:"No invoices are available.",uploadDocument:"Upload Document",pending:"Pending",notAssigned:"Not assigned",notReceived:"Not received",messageRequired:"Enter a message.",secureMessage:"Send a secure message",clientOnly:"Client only"
      }[key] || key.charAt(0).toUpperCase()+key.slice(1));
      const uiPhraseArabic=Object.freeze({
        "Secure production workspace":"مساحة العمل الإنتاجية الآمنة","Secure account activation":"تفعيل الحساب الآمن","Create your password":"أنشئ كلمة المرور","Complete the invitation using a unique password of at least 12 characters.":"أكمل الدعوة بكلمة مرور فريدة لا تقل عن 12 حرفًا.","Activate Account":"تفعيل الحساب","Secure Client Portal":"بوابة العميل الآمنة","Immigration Operations":"عمليات الهجرة","Authenticated user":"المستخدم المصادق عليه","Loading access…":"جارٍ تحميل الصلاحيات…","Production Environment":"بيئة الإنتاج","Secure sign out":"تسجيل خروج آمن","Global search":"البحث الشامل","New Client":"عميل جديد","New Task":"مهمة جديدة","New Invoice":"فاتورة جديدة","System check":"فحص النظام","Verify all production services.":"تحقق من جميع خدمات الإنتاج.","Live readiness":"الجاهزية المباشرة","Operational Alerts":"التنبيهات التشغيلية","Deadlines, tasks, and expiring records":"المواعيد والمهام والسجلات المنتهية","Requires Attention Now":"يتطلب إجراءً الآن","Persisted exceptions across cases, tasks, and documents":"استثناءات محفوظة في الملفات والمهام والمستندات","Workflow Distribution":"توزيع سير العمل","Cases by current stage":"الملفات حسب المرحلة الحالية","Document Health":"سلامة المستندات","Received or returned documents":"المستندات المستلمة أو المعادة","Operational Breakdown":"التوزيع التشغيلي","Current persistent records":"السجلات الحالية المحفوظة","Operational shortcuts":"اختصارات التشغيل","Active production matters":"الملفات الإنتاجية النشطة","Latest production records":"أحدث السجلات الإنتاجية","Start a new client matter.":"ابدأ ملف عميل جديدًا.","Create case":"إنشاء ملف","Store evidence in R2.":"حفظ الأدلة في R2.","Upload document":"رفع مستند","Manage staff workload.":"إدارة عبء عمل الموظفين.","Create task":"إنشاء مهمة","Review State":"حالة المراجعة","Review and classification state":"حالة المراجعة والتصنيف","Assigned to":"مسند إلى","All service categories":"جميع فئات الخدمات","All Tasks":"جميع المهام","My Tasks":"مهامي","Due Today":"مستحق اليوم","Overdue":"متأخر","Open Deadlines":"المواعيد النهائية المفتوحة","Document Center":"مركز المستندات","Direct upload to Cloudflare R2 with Supabase metadata":"رفع مباشر إلى Cloudflare R2 مع بيانات Supabase","Drop a document here or choose a file":"أفلت مستندًا هنا أو اختر ملفًا","PDF, JPG, PNG, WebP, DOC or DOCX · Maximum 25MB":"PDF أو JPG أو PNG أو WebP أو DOC أو DOCX · الحد الأقصى 25MB","Smart identity intake":"استقبال الهوية الذكي","Passport or government ID":"جواز سفر أو هوية حكومية","The image is processed by OCR and MRZ validation. Nothing is saved until a person reviews and confirms the extracted fields.":"تُعالج الصورة بتقنية OCR والتحقق من MRZ. لا يُحفظ شيء حتى يراجع شخص الحقول المستخرجة ويؤكدها.","Upload identity":"رفع الهوية","I reviewed the image and confirm these fields are accurate.":"راجعت الصورة وأؤكد دقة هذه الحقول.","Confirm, autofill and save":"تأكيد وتعبئة وحفظ","File":"الملف","Case / Client":"الملف / العميل","Size":"الحجم","Stored in Cloudflare R2":"محفوظ في Cloudflare R2","Services":"الخدمات","Service Intake":"استقبال الخدمة","Versioned intake and controlled case workflow.":"استقبال بإصدارات وسير عمل مضبوط للملف.","Open intake →":"فتح الاستقبال ←","Case Review Queue":"قائمة مراجعة الملفات","Matters awaiting controlled review":"ملفات بانتظار المراجعة المنضبطة","Document Review Queue":"قائمة مراجعة المستندات","Office, government, and other fees remain separated":"تبقى رسوم المكتب والحكومة والرسوم الأخرى منفصلة","Amounts are entered in U.S. dollars":"تُدخل المبالغ بالدولار الأمريكي","Office fee":"رسوم المكتب","Government fee":"الرسوم الحكومية","Other fee":"رسوم أخرى","Administrative Services":"الخدمات الإدارية","Family / USCIS":"العائلة / USCIS","Consular / DOS":"القنصلية / DOS","Humanitarian / Complex":"الإنسانية / المعقدة","Case and document events":"أحداث الملفات والمستندات","Authenticated users and assigned roles":"المستخدمون المصادق عليهم والأدوار المسندة","Invite User":"دعوة مستخدم","Manage User":"إدارة المستخدم","Staff default to firm-wide access. Nothing is narrowed until you record a decision here.":"يبدأ الموظفون بوصول على مستوى المكتب. لا يُضيّق الوصول حتى تسجل قرارًا هنا.","Effective Access":"الوصول الفعلي","Effective scope":"النطاق الفعلي","Save policy":"حفظ السياسة","Reset to defaults":"إعادة الإعدادات الافتراضية","Record Access":"وصول السجل","Hand one case or one client to someone, or take one away, regardless of their scope.":"امنح شخصًا ملفًا أو عميلًا محددًا أو احجبه عنه بصرف النظر عن نطاقه.","Teams back the team scope. Membership alone never narrows anyone.":"تدعم الفرق نطاق الفريق. العضوية وحدها لا تضيّق الوصول.","Create team":"إنشاء فريق","Add to team":"إضافة إلى الفريق","Client communication and portal identity":"هوية البوابة ومراسلات العميل","Personal display and interface language":"لغة العرض والواجهة الشخصية","Production configuration status":"حالة إعداد الإنتاج","Environment":"البيئة","Database":"قاعدة البيانات","Object Storage":"تخزين الكائنات","Email Delivery":"تسليم البريد","Checking":"جارٍ التحقق","Infrastructure":"البنية التحتية","Supabase":"Supabase","Cloudflare R2":"Cloudflare R2","User Authentication":"مصادقة المستخدم","Create New Case":"إنشاء ملف جديد","Existing client":"عميل قائم","Client name if not yet registered":"اسم العميل إن لم يكن مسجلًا","Case type":"نوع الخدمة","Operational assignment":"الإسناد التشغيلي","Operational notes":"الملاحظات التشغيلية","Save Case":"حفظ الملف","Create Client":"إنشاء عميل","Legal name":"الاسم القانوني","Date of birth":"تاريخ الميلاد","Nationality":"الجنسية","Place of birth":"مكان الميلاد","Passport number":"رقم الجواز","USCIS Online Account Number":"رقم حساب USCIS الإلكتروني","Physical address":"العنوان الفعلي","ZIP / Postal code":"الرمز البريدي","Save Client":"حفظ العميل","Create Task":"إنشاء مهمة","Task title":"عنوان المهمة","Description":"الوصف","Assignee":"الموظف المسؤول","Due date":"تاريخ الاستحقاق","Save Task":"حفظ المهمة","Create Invoice":"إنشاء فاتورة","Government Fee":"رسوم الحكومة","Office Fee":"رسوم المكتب","Save Invoice":"حفظ الفاتورة","Secure account":"حساب آمن","Back":"السابق","Next":"التالي","Save & Exit":"حفظ وخروج","Confirm the information":"تأكيد المعلومات","Review every section. Use Edit to correct information before submitting.":"راجع كل قسم. استخدم تعديل لتصحيح المعلومات قبل الإرسال.","No information entered":"لم تُدخل معلومات","Add family member":"إضافة فرد من العائلة","Remove":"إزالة","Select":"اختر","Apply":"تطبيق","Clear this browser session.":"مسح جلسة هذا المتصفح.","Language":"اللغة","English":"English","Arabic":"العربية","Subject":"الجهة المستهدفة","Resource":"المورد","Effect":"الأثر","Grant":"سماح","Restrict":"تقييد","Roles":"الأدوار","Team":"الفريق","User":"المستخدم","Module":"الوحدة","Resource type":"نوع المورد","Subject type":"نوع الجهة","Granted permissions (beyond role defaults)":"الصلاحيات الممنوحة إضافة إلى الدور","Restricted permissions":"الصلاحيات المقيدة","New team name":"اسم الفريق الجديد","Select client":"اختر العميل","Agency notice":"إشعار الجهة","Agency processing":"معالجة الجهة","Client evidence pending":"بانتظار أدلة العميل","Financial evidence":"الأدلة المالية","Relationship evidence":"أدلة العلاقة","Civil document":"مستند مدني","Unclassified":"غير مصنف","Review":"مراجعة","Received":"مستلم","Uploaded":"مرفوع","In progress":"قيد التنفيذ","Waiting":"انتظار","Blocked":"محجوب","Active":"نشط","Inactive":"غير نشط","Invited":"مدعو","Completed":"مكتمل","Closed":"مغلق","Urgent":"عاجل","High":"عالٍ","Normal":"عادي","Low":"منخفض","Open Cases":"الملفات المفتوحة","Current country":"البلد الحالي","Immigration status":"وضع الهجرة","Passport expiration":"انتهاء الجواز","Reviewed legal name":"الاسم القانوني المراجع","Reviewed date of birth":"تاريخ الميلاد المراجع","Reviewed nationality":"الجنسية المراجعة","Reviewed place of birth":"مكان الميلاد المراجع","Reviewed passport / ID number":"رقم الجواز / الهوية المراجع","Reviewed issuing country":"بلد الإصدار المراجع","Reviewed expiration date":"تاريخ الانتهاء المراجع"
      });
      const supplementalUiPhraseArabic=Object.freeze({
        "Sign in with your assigned account. Your session is protected with secure, HTTP-only cookies.":"سجّل الدخول بحسابك المخصص. جلستك محمية بملفات تعريف ارتباط آمنة لا تستطيع الصفحة قراءتها.",
        "Work email":"البريد الإلكتروني للعمل","Password":"كلمة المرور","Sign In":"تسجيل الدخول","New password":"كلمة المرور الجديدة","Confirm password":"تأكيد كلمة المرور",
        "No active alerts.":"لا توجد تنبيهات نشطة.","No urgent operational exceptions.":"لا توجد استثناءات تشغيلية عاجلة.","No active case workflow data.":"لا توجد بيانات نشطة لسير الملفات.",
        "Open":"فتح","Edit":"تعديل","Preview":"معاينة","Download":"تنزيل","Delete":"حذف","Unknown":"غير معروف","Unknown type":"نوع غير معروف","Approve":"اعتماد","Reject":"رفض","Manage":"إدارة",
        "No cases awaiting review.":"لا توجد ملفات بانتظار المراجعة.","No documents awaiting review.":"لا توجد مستندات بانتظار المراجعة.",
        "System":"النظام","Client only":"عميل فقط","Client":"العميل","Case":"الملف","Status":"الحالة","Priority":"الأولوية","Category":"الفئة","Notes":"الملاحظات",
        "Identity":"الهوية","Translation":"الترجمة","Other":"أخرى","Email":"البريد الإلكتروني","Phone":"الهاتف","WhatsApp":"واتساب","A-Number":"رقم الأجنبي",
        "Production record":"سجل إنتاجي","Save Access":"حفظ الوصول","Case workspace":"مساحة عمل الملف","Send a secure message":"إرسال رسالة آمنة",
        "Rejected document requires replacement":"المستند المرفوض يحتاج إلى بديل","Overdue task":"مهمة متأخرة","Save Mapping":"حفظ الربط","Dry Run":"تشغيل تجريبي",
        "PNG, JPG, WebP or SVG · 2 MB maximum":"PNG أو JPG أو WebP أو SVG · الحد الأقصى 2 ميغابايت"
      });
      const originalUiText=new WeakMap(),originalUiAttributes=new WeakMap();
      function translatedUiPhrase(value){
        const text=String(value||""),trimmed=text.trim(),normalized=trimmed.replace(/\s+/g," ");if(!trimmed)return text;
        let translated=uiPhraseArabic[trimmed]||uiPhraseArabic[normalized]||supplementalUiPhraseArabic[trimmed]||supplementalUiPhraseArabic[normalized]||Object.entries(translations.ar).find(([key])=>key===trimmed||key===normalized)?.[1];
        if(!translated&&/^Version\s+/.test(trimmed))translated=trimmed.replace(/^Version/,"الإصدار");
        if(!translated&&/^Family member (\d+)$/.test(trimmed))translated=trimmed.replace(/^Family member/,"فرد العائلة");
        if(!translated&&/^(\d+) fields$/.test(trimmed))translated=trimmed.replace(/ fields$/," حقول");
        return translated?text.replace(trimmed,translated):text;
      }
      function localizeTree(root=document.body){
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
        while((node=walker.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,[data-i18n]'))continue;if(!originalUiText.has(node))originalUiText.set(node,node.nodeValue);const original=originalUiText.get(node);node.nodeValue=currentLanguage==="Arabic"?translatedUiPhrase(original):original;}
        root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(element=>{if(!originalUiAttributes.has(element))originalUiAttributes.set(element,{placeholder:element.getAttribute('placeholder'),title:element.getAttribute('title'),'aria-label':element.getAttribute('aria-label')});const originals=originalUiAttributes.get(element);for(const attribute of ['placeholder','title','aria-label'])if(originals[attribute]!==null)element.setAttribute(attribute,currentLanguage==="Arabic"?translatedUiPhrase(originals[attribute]):originals[attribute]);});
      }
      function applyTranslations(){
        document.documentElement.lang=currentLanguage==="Arabic"?"ar":"en";
        document.documentElement.dir=currentLanguage==="Arabic"?"rtl":"ltr";
        document.body.classList.toggle("rtl",currentLanguage==="Arabic");
        document.querySelectorAll("[data-i18n]").forEach(element=>element.textContent=tr(element.dataset.i18n));
        document.querySelectorAll("[data-i18n-placeholder]").forEach(element=>element.placeholder=tr(element.dataset.i18nPlaceholder));
        document.querySelectorAll('[data-act="switchLanguage"]').forEach(switcher=>switcher.value=currentLanguage);
        localizeTree();
        const activeView=document.querySelector("#nav button.active")?.dataset.view;if(activeView)titles(activeView);
      }
      let localizationQueued=false;
      new MutationObserver(()=>{if(currentLanguage!=="Arabic"||localizationQueued)return;localizationQueued=true;queueMicrotask(()=>{localizationQueued=false;localizeTree();});}).observe(document.body,{childList:true,subtree:true});
      function setLanguage(language){currentLanguage=/^(Arabic|ar|العربية)$/i.test(String(language||""))?"Arabic":"English";applyTranslations();}
      async function switchLanguage(language){
        setLanguage(language);
        if(!currentUser)return;
        const portalUser=(currentUser.roles||[]).some(role=>role.startsWith("client_"));
        try{await api(portalUser?"/api/v1/portal/language":"/api/v1/profile/preferences",{method:"PATCH",body:JSON.stringify({preferred_language:currentLanguage})});currentUser.preferred_language=currentLanguage;if(portalUser&&portalData)renderPortal();else{const activeView=document.querySelector("#nav button.active")?.dataset.view;if(activeView)await loadViewData(activeView,true);const workspaceId=$("workspaceEditButton")?.dataset.a1;if(workspaceId&&$("caseWorkspaceModal").classList.contains("show"))await editCase(workspaceId);}}catch(error){alert(error.message)}
      }
      const viewLoadedAt = new Map(),
        viewLoads = new Map(),
        viewCacheMs = 30_000;
      const roles = [
        ["Owner", "Full platform authority and configuration control.", "owner"],
        ["Admin", "Operational administration and user management.", "admin"],
        ["Supervisor", "Oversight, assignments and review authority.", "supervisor"],
        ["Case Manager", "Case ownership, workflow and client coordination.", "case_manager"],
        ["Form Preparer", "Prepare forms and structured intake records.", "form_preparer"],
        ["Document Reviewer", "Review evidence and document completeness.", "document_reviewer"],
        ["Translator", "Translation workflow access.", "translator"],
        [
          "Attorney / Accredited Representative",
          "Legal representation workspace.",
          "attorney_accredited_representative",
        ],
        ["Billing", "Payments, invoices and account records.", "billing"],
        ["Auditor", "Read-only compliance and audit access.", "auditor"],
        ["Client Owner", "Primary client portal authority.", "client_owner"],
        ["Client Collaborator", "Limited shared case collaboration.", "client_collaborator"],
      ];
      function titles(v) {
        const t = {
          dashboard: ["operationsConsole", "caseManagementDashboard"],
          cases: ["operationsConsole", "cases"],
          clients: ["clientProfile", "clients"],
          documents: ["operationsConsole", "documents"],
          services: ["operationsConsole", "services"],
          tasks: ["workflowStage", "tasks"],
          reviews: ["requiredActions", "reviewQueue"],
          billing: ["operationsConsole", "billing"],
          reports: ["operationsConsole", "reports"],
          imports: ["bulkImport", "importCenter"],
          roles: ["accessControl", "teamRoles"],
          audit: ["activityAudit", "auditTrail"],
          access: ["accessControl", "accessControl"],
          settings: ["workspaceSettings", "settings"],
        };
        $("sectionEyebrow").textContent = tr(t[v][0]);
        $("sectionTitle").textContent = tr(t[v][1]);
      }
      function showView(v) {
        document
          .querySelectorAll(".view")
          .forEach((x) => x.classList.remove("active"));
        $("view-" + v).classList.add("active");
        document
          .querySelectorAll("#nav button")
          .forEach((x) => x.classList.toggle("active", x.dataset.view === v));
        titles(v);
        if (v === "cases" && viewLoadedAt.has("cases")) renderCaseTable();
        loadViewData(v);
      }
      const viewLoaders = {
        cases: loadCases,
        clients: loadClients,
        documents: loadDocuments,
        services: loadServices,
        tasks: loadTasks,
        reviews: loadReviewQueue,
        billing: loadBilling,
        reports: loadReports,
        imports: loadImports,
        roles: loadTeam,
        audit: loadAudit,
        access: () => allowedTo("access.manage") ? loadAccess() : Promise.resolve(),
        settings: loadSettings,
      };
      function loadViewData(view, force = false) {
        const loader = viewLoaders[view];
        if (!loader) return Promise.resolve();
        if (!force && Date.now() - (viewLoadedAt.get(view) || 0) < viewCacheMs) return Promise.resolve();
        if (viewLoads.has(view)) return viewLoads.get(view);
        const pending = Promise.resolve(loader())
          .then(() => viewLoadedAt.set(view, Date.now()))
          .finally(() => viewLoads.delete(view));
        viewLoads.set(view, pending);
        return pending;
      }
      // Views the signed-in principal has no permission for are removed from
      // the navigation. The API denies them regardless; this stops the shell
      // advertising a destination that answers 403, and keeps the visible menu
      // in step with whatever the Owner has configured rather than with a
      // second hardcoded role table.
      const viewPermissions = {
        dashboard: "dashboard.view",
        cases: "cases.view",
        clients: "clients.view",
        documents: "documents.view",
        services: "cases.view",
        tasks: "tasks.view",
        reviews: "documents.review",
        billing: "billing.view",
        reports: "reports.view",
        imports: "imports.manage",
        roles: "users.view",
        audit: "audit.view",
        access: "access.manage",
        settings: "settings.manage",
      };
      function allowedTo(permission) {
        const held = currentUser?.permissions || [];
        return held.includes("*") || held.includes(permission);
      }
      function configureNavigation() {
        if (currentUser) {
          const profile = $("ownerProfile");
          if (profile) {
            profile.querySelector("b").textContent = currentUser.display_name || currentUser.email;
            profile.querySelector("small").textContent = (currentUser.roles || []).map(intakeOptionLabel).join(" · ");
          }
        }
        let firstVisible = null;
        document.querySelectorAll("#nav button").forEach((button) => {
          const ok = allowedTo(viewPermissions[button.dataset.view] || "dashboard.view");
          button.style.display = ok ? "block" : "none";
          if (ok && !firstVisible) firstVisible = button.dataset.view;
        });
        $("newCaseButton").style.display = allowedTo("cases.manage") ? "inline-block" : "none";
        const active = document.querySelector("#nav button.active");
        if (firstVisible && (!active || active.style.display === "none")) showView(firstVisible);
      }
      document
        .querySelectorAll("#nav button")
        .forEach((b) => (b.onclick = () => showView(b.dataset.view)));
      async function api(path, opt = {}) {
        const r = await fetch(path, {
          ...opt,
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            ...(opt.headers || {}),
          },
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (r.status === 401) $("login").classList.remove("hidden");
          const error = new Error(j.error || "HTTP " + r.status);
          if (j.fields) error.detail = Object.values(j.fields).join(" ");
          throw error;
        }
        return j;
      }
      async function signIn() {
        const email = $("email").value.trim();
        const password = $("password").value;
        $("loginErr").textContent = "";
        if (!email || !password)
          return ($("loginErr").textContent =
            "Email and password are required.");
        try {
          const result = await api("/api/v1/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
          });
          currentUser = result.user;
          setLanguage(currentUser.preferred_language);
          $("password").value = "";
          $("login").classList.add("hidden");
          const clientUser = currentUser.roles.some((role) => role === "client_owner" || role === "client_collaborator");
          if (clientUser) {
            $("staffApp").style.display = "none";
            $("clientPortal").classList.add("active");
            await loadPortal();
          } else await boot();
        } catch (e) {
          $("loginErr").textContent =
            e.message === "INVALID_CREDENTIALS"
              ? "Email or password is incorrect."
              : e.message;
        }
      }
      function prepareInvitation() {
        const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
        if (!["invite", "recovery"].includes(fragment.get("type")) || !fragment.get("access_token")) return false;
        inviteAccessToken = fragment.get("access_token");
        history.replaceState(null, "", location.pathname + location.search);
        $("loginBox").style.display = "none";
        $("inviteSetup").style.display = "block";
        $("login").classList.remove("hidden");
        return true;
      }
      async function acceptInvite() {
        const password = $("invitePassword").value;
        const confirmation = $("invitePasswordConfirm").value;
        $("inviteSetupErr").textContent = "";
        if (!inviteAccessToken) return ($("inviteSetupErr").textContent = "This invitation is invalid or expired.");
        if (password.length < 12) return ($("inviteSetupErr").textContent = "Use at least 12 characters.");
        if (password !== confirmation) return ($("inviteSetupErr").textContent = "Passwords do not match.");
        try {
          const result = await api("/api/v1/auth/accept-invite", {
            method: "POST",
            body: JSON.stringify({ access_token: inviteAccessToken, password }),
          });
          inviteAccessToken = null;
          $("invitePassword").value = "";
          $("invitePasswordConfirm").value = "";
          currentUser = result.user;
          setLanguage(currentUser.preferred_language);
          $("inviteSetup").style.display = "none";
          $("login").classList.add("hidden");
          const clientUser = currentUser.roles.some((role) => role === "client_owner" || role === "client_collaborator");
          if (clientUser) {
            $("staffApp").style.display = "none";
            $("clientPortal").classList.add("active");
            await loadPortal();
          } else await boot();
        } catch (error) {
          $("inviteSetupErr").textContent = error.message === "INVALID_INVITATION"
            ? "This invitation is invalid or expired."
            : error.message;
        }
      }
      async function signOut() {
        try {
          await api("/api/v1/auth/logout", { method: "POST", body: "{}" });
        } catch {}
        location.reload();
      }
      async function testReady() {
        try {
          const r = await fetch("/ready"),
            j = await r.json();
          $("version").textContent = "Version " + j.version;
          $("dot").className = "dot " + (j.status === "ready" ? "on" : "");
          $("live").textContent =
            j.status === "ready"
              ? "All systems operational"
              : "Attention required";
          $("supabase").textContent = j.checks.supabase
            ? "Operational"
            : "Offline";
          $("r2").textContent = j.checks.r2 ? "Operational" : "Offline";
          $("auth").textContent = j.checks.userAuth
            ? "Protected"
            : "Offline";
          $("setDb").textContent = j.checks.supabase ? "Connected" : "Offline";
          $("setR2").textContent = j.checks.r2 ? "Connected" : "Offline";
          for (const id of ["supabase", "r2", "auth", "setDb", "setR2"])
            $(id).className = $(id).textContent === "Offline" ? "" : "ok";
        } catch {
          $("live").textContent = "Service unavailable";
        }
      }
      async function loadSettings(){
        try{
          const [office,profile]=await Promise.all([api("/api/v1/settings/office"),api("/api/v1/profile/preferences")]);
          const values={officeName:office.data.office_name,officeEmail:office.data.office_email,officePhone:office.data.office_phone,officeWhatsapp:office.data.office_whatsapp,officeAddress:office.data.office_address,officeDefaultLanguage:office.data.default_language,officeFooterEn:office.data.email_footer_en,officeFooterAr:office.data.email_footer_ar,profileDisplayName:profile.data.display_name,profileLanguage:profile.data.preferred_language};
          for(const [id,value] of Object.entries(values))if($(id))$(id).value=value||"";
          $("officeLogoPreview").innerHTML=office.data.logo_url?`<img src="${esc(office.data.logo_url)}?v=${Date.now()}" alt="Office logo">`:'<span>A</span>';
          $("emailProviderStatus").textContent=office.data.email_provider_status||"PROVIDER_NOT_CONFIGURED";
          $("settingsErr").textContent="";
        }catch(error){$("settingsErr").textContent=error.message}
      }
      async function saveOfficeSettings(){
        try{
          await api("/api/v1/settings/office",{method:"PATCH",body:JSON.stringify({office_name:$("officeName").value,office_email:$("officeEmail").value,office_phone:$("officePhone").value,office_whatsapp:$("officeWhatsapp").value,office_address:$("officeAddress").value,default_language:$("officeDefaultLanguage").value,email_footer_en:$("officeFooterEn").value,email_footer_ar:$("officeFooterAr").value})});
          $("settingsErr").textContent="Saved";await loadSettings();
        }catch(error){$("settingsErr").textContent=error.message}
      }
      async function saveProfileSettings(){
        try{
          const language=$("profileLanguage").value;
          await api("/api/v1/profile/preferences",{method:"PATCH",body:JSON.stringify({display_name:$("profileDisplayName").value,preferred_language:language})});
          currentUser.display_name=$("profileDisplayName").value;currentUser.preferred_language=language;setLanguage(language);configureNavigation();$("settingsErr").textContent="Saved";
        }catch(error){$("settingsErr").textContent=error.message}
      }
      function chooseOfficeLogo(){$("officeLogoFile").value="";$("officeLogoFile").click()}
      async function uploadOfficeLogo(file){
        if(!file)return;if(!["image/png","image/jpeg","image/webp","image/svg+xml"].includes(file.type))return $("settingsErr").textContent="Use PNG, JPG, WebP or SVG.";
        try{
          const response=await fetch("/api/v1/settings/logo",{method:"POST",credentials:"same-origin",headers:{"content-type":file.type},body:file});
          const result=await response.json();if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);await loadSettings();
        }catch(error){$("settingsErr").textContent=error.message}
      }
      async function loadAlerts() {
        try {
          const result = await api("/api/v1/alerts");
          alerts = result.data || [];
          $("alertList").innerHTML = alerts.slice(0,8).map((item) => `<div class="row"><div><b>${esc(item.title)}</b><small>${esc(intakeOptionLabel(item.alert_type))} · ${date(item.due_at)}</small></div><span class="tag ${item.severity === "critical" || item.severity === "high" ? "urgent" : "normal"}">${esc(item.severity)}</span></div>`).join("") || '<div class="empty">No active alerts.</div>';
          renderOperationsDashboard();
        } catch { $("alertList").innerHTML = '<div class="empty">Alerts are not available for this role.</div>'; }
      }
      async function refreshAlerts() {
        try { await api("/api/v1/alerts/refresh", { method: "POST", body: "{}" }); await loadAlerts(); } catch (error) { alert(error.message); }
      }
      async function loadCases() {
        try {
          const j = await api("/api/v1/cases?limit=250");
          cases = j.data || [];
          renderMetrics();
          renderRecent();
          renderCaseTable();
          fillCaseSelect();
        } catch (e) {
          $("recentCases").innerHTML =
            '<div class="empty">Unable to load cases.</div>';
        }
      }
      async function unifiedSearch(){
        const input=$("globalSearch"),results=$("globalSearchResults"),q=input?.value.trim()||"";
        if(q.length<2){results?.classList.remove("show");if(results)results.innerHTML="";return}
        try{
          const response=await api(`/api/v1/search?q=${encodeURIComponent(q)}`),data=response.data||{};
          const caseItems=(data.cases||[]).map(item=>`<button data-act="editCase" data-a1="${item.id}"><b>${esc(item.case_number||item.case_reference)}</b><span>${esc(item.client_name)} · ${esc(item.case_type)}</span></button>`);
          const clientItems=(data.clients||[]).map(item=>`<button data-act="openSearchClient" data-a1="${item.id}"><b>${esc(item.client_number)}</b><span>${esc(currentLanguage==="Arabic"&&item.legal_name_ar?item.legal_name_ar:item.legal_name)} · ${esc(item.email||item.phone||"")}</span></button>`);
          results.innerHTML=[...caseItems,...clientItems].join("")||`<div class="empty">${esc(tr("noRecords"))}</div>`;results.classList.add("show");
        }catch(error){results.innerHTML=`<div class="empty">${esc(error.message)}</div>`;results.classList.add("show")}
      }
      async function openSearchClient(id){
        let client=clients.find(item=>item.id===id);
        if(!client){const response=await api(`/api/v1/clients/${id}`);client=response.data;clients.unshift(client)}
        $("globalSearchResults").classList.remove("show");editClient(id);
      }
      function renderMetrics() {
        const stage = (item) => item.workflow_stage || item.status || "intake";
        const today = new Date().toISOString().slice(0, 10);
        $("totalCases").textContent = cases.filter((x) => !["closed", "archived"].includes(stage(x))).length;
        $("intakeCases").textContent = cases.filter((x) => stage(x) === "intake").length;
        $("highCases").textContent = cases.filter((x) =>
          ["high", "urgent"].includes(x.priority),
        ).length;
        if ($("awaitingDocs")) $("awaitingDocs").textContent = cases.filter((x) => stage(x) === "awaiting_documents").length;
        if ($("readyToFile")) $("readyToFile").textContent = cases.filter((x) => stage(x) === "ready_to_file").length;
        if ($("filedCases")) $("filedCases").textContent = cases.filter((x) => ["filed", "receipt_received"].includes(stage(x))).length;
        if ($("overdueTasks")) $("overdueTasks").textContent = tasks.filter((x) => x.due_date && x.due_date < today && x.status !== "completed").length;
        if ($("urgentAlerts")) $("urgentAlerts").textContent = alerts.filter((x) => ["critical", "high"].includes(x.severity)).length;
        renderOperationsDashboard();
      }
      function renderOperationsDashboard() {
        if (!$("operationsAttention")) return;
        const today = new Date().toISOString().slice(0, 10);
        const stage = (item) => item.workflow_stage || item.status || "intake";
        const attention = [
          ...tasks.filter((item) => item.due_date && item.due_date < today && item.status !== "completed").map((item) => ({ title: item.title, detail: `Overdue task · ${item.due_date}`, kind: "urgent", view: "tasks" })),
          ...docs.filter((item) => item.review_status === "rejected").map((item) => ({ title: item.file_name, detail: "Rejected document requires replacement", kind: "urgent", view: "documents" })),
          ...cases.filter((item) => ["high", "urgent"].includes(item.priority)).map((item) => ({ title: item.client_name || item.case_reference || "Case", detail: `${item.case_type} · ${intakeOptionLabel(stage(item))}`, kind: item.priority, view: "cases" })),
        ].slice(0, 8);
        $("operationsAttention").innerHTML = attention.map((item) => `<button class="ops-item" data-act="showView" data-a1="${item.view}"><span><b>${esc(item.title)}</b><small>${esc(item.detail)}</small></span><span class="tag ${esc(item.kind)}">Open</span></button>`).join("") || '<div class="empty">No urgent operational exceptions.</div>';
        const distribution = Object.entries(cases.reduce((result, item) => { const key = stage(item); result[key] = (result[key] || 0) + 1; return result; }, {})).sort((a, b) => b[1] - a[1]);
        $("workflowDistribution").innerHTML = distribution.map(([key, count]) => `<button class="distribution-row" data-act="showView" data-a1="cases"><span>${esc(intakeOptionLabel(key))}</span><b>${count}</b></button>`).join("") || '<div class="empty">No active case workflow data.</div>';
        const health = {
          approved: docs.filter((item) => item.review_status === "approved").length,
          pending_review: docs.filter((item) => ["received", "under_review", "pending_review"].includes(item.review_status)).length,
          rejected: docs.filter((item) => item.review_status === "rejected").length,
          unclassified: docs.filter((item) => !item.category).length,
        };
        $("documentHealth").innerHTML = Object.entries(health).map(([key, count]) => `<button class="distribution-row" data-act="showView" data-a1="documents"><span>${esc(intakeOptionLabel(key))}</span><b>${count}</b></button>`).join("");
      }
      function renderRecent() {
        const a = cases.slice(0, 7);
        $("recentCases").innerHTML = a.length
          ? a
              .map(
                (x) =>
                  `<div class="row"><div><strong>${esc(x.client_name)}</strong><small>${esc(x.case_type)}</small></div><div class="hide-sm"><span class="tag">${esc(x.status)}</span></div><div class="hide-sm"><span class="tag ${esc(x.priority)}">${esc(x.priority)}</span></div><button class="linkbtn" data-act="editCase" data-a1="${x.id}">Open</button></div>`,
              )
              .join("")
          : '<div class="empty">No cases yet. Create the first case.</div>';
      }
      function renderCaseTable() {
        const q = ($("caseSearch")?.value || "").toLowerCase();
        const a = cases.filter((x) =>
          JSON.stringify(x).toLowerCase().includes(q),
        );
        $("caseTable").innerHTML =
          a
            .map(
              (x) =>
                `<tr><td><b>${esc(x.case_number||x.case_reference||"—")}</b></td><td><b>${esc(x.client_name)}</b></td><td>${esc(x.case_type)}</td><td>${esc(x.workflow_stage||x.status)}</td><td>${esc(x.priority)}</td><td>${esc(x.assigned_to || "—")}</td><td><button class="linkbtn" data-act="editCase" data-a1="${x.id}">${esc(tr("open"))}</button></td></tr>`,
            )
            .join("") || '<tr><td colspan="7">No matching cases.</td></tr>';
      }
      async function loadClients() {
        try {
          const result = await api("/api/v1/clients?limit=250");
          clients = result.data || [];
          renderClients();
          fillClientSelects();
        } catch (error) {
          $("clientTable").innerHTML =
            '<tr><td colspan="6">Unable to load client records.</td></tr>';
        }
      }
      function renderClients() {
        const q = ($("clientSearch")?.value || "").toLowerCase();
        const visible = clients.filter((client) =>
          [client.client_number,client.legal_name,client.legal_name_ar,client.email,client.phone,client.whatsapp,client.a_number,client.uscis_account_number,client.passport_number]
            .some((value) => String(value || "").toLowerCase().includes(q)),
        );
        $("clientTable").innerHTML =
          visible
            .map(
              (client) =>
                `<tr><td><b>${esc(client.client_number||"—")}</b></td><td><b>${esc(currentLanguage==="Arabic"&&client.legal_name_ar?client.legal_name_ar:client.legal_name)}</b><br><small>${esc(client.nationality || "—")}</small></td><td>${esc(client.email || client.phone || "—")}</td><td>${esc(client.a_number || "—")}</td><td>${esc(client.preferred_language || "—")}</td><td><button class="linkbtn" data-act="editClient" data-a1="${client.id}">${esc(tr("edit"))}</button></td></tr>`,
            )
            .join("") || '<tr><td colspan="6">No matching clients.</td></tr>';
      }
      function fillClientSelects() {
        const options = clients.map((client) => `<option value="${client.id}">${esc(client.legal_name)}</option>`).join("");
        if ($("taskClient")) $("taskClient").innerHTML = '<option value="">Select client if no case</option>' + options;
        if ($("caseClientSelect")) $("caseClientSelect").innerHTML = '<option value="">Select client</option>' + options;
      }
      function openClient() {
        $("clientModalTitle").textContent = "Create Client";
        $("editClientId").value = "";
        for (const id of ["clientLegalName","clientLegalNameAr","clientDob","clientBirthPlace","clientNationality","clientCountry","clientEmail","clientPhone","clientWhatsapp","clientLanguage","clientANumber","clientUscisNumber","clientPassport","clientPassportExpiration","clientAddress","clientPostal","clientImmigrationStatus","clientNotes"]) $(id).value = "";
        $("clientErr").textContent = "";
        resetIdentityIntake();
        $("clientModal").classList.add("show");
      }
      function editClient(id) {
        const client = clients.find((item) => item.id === id);
        if (!client) return;
        $("clientModalTitle").textContent = "Edit Client";
        $("editClientId").value = id;
        const values = {
          clientLegalName: client.legal_name,clientLegalNameAr:client.legal_name_ar, clientDob: client.date_of_birth,
          clientBirthPlace: client.place_of_birth, clientNationality: client.nationality,
          clientCountry: client.current_country, clientEmail: client.email,
          clientPhone: client.phone, clientWhatsapp: client.whatsapp,
          clientLanguage: client.preferred_language, clientANumber: client.a_number,
          clientUscisNumber: client.uscis_account_number, clientPassport: client.passport_number,
          clientPassportExpiration: client.passport_expiration, clientAddress: client.physical_address,
          clientPostal: client.postal_code, clientImmigrationStatus: client.immigration_status,
          clientNotes: client.operational_notes,
        };
        for (const [field, value] of Object.entries(values)) $(field).value = value || "";
        $("clientErr").textContent = "";
        resetIdentityIntake();
        $("clientModal").classList.add("show");
      }
      function closeClient() {
        $("clientModal").classList.remove("show");
      }
      function resetIdentityIntake() {
        identityExtractionToken = null;
        if ($("identityFile")) $("identityFile").value = "";
        if ($("identityProgress")) $("identityProgress").style.width = "0";
        if ($("identityStatus")) $("identityStatus").textContent = "";
        if ($("identityReview")) $("identityReview").style.display = "none";
        if ($("identityConfirmed")) $("identityConfirmed").checked = false;
      }
      function chooseIdentityFile() { $("identityFile").click(); }
      async function runIdentityOcr(file) {
        if (!file) return;
        $("clientErr").textContent = "";
        if (!["image/jpeg","image/png","image/webp"].includes(file.type)) return ($("clientErr").textContent = "Use a JPG, PNG or WebP identity image.");
        try {
          $("identityStatus").textContent = "Reading identity document…";
          const query = new URLSearchParams({ filename: file.name, size_bytes: String(file.size) });
          const response = await uploadWithProgress(`/api/v1/identity/ocr?${query}`, file, (percent) => $("identityProgress").style.width = `${percent}%`);
          identityExtractionToken = response.extraction_token;
          const result = response.result, fields = result.fields || {};
          const values = {
            identityLegalName: fields.legal_name,
            identityDob: fields.date_of_birth,
            identityBirthPlace: fields.place_of_birth,
            identityNationality: fields.nationality,
            identityNumber: fields.passport_number,
            identityCountry: fields.passport_country,
            identityExpiration: fields.passport_expiration,
          };
          for (const [id, value] of Object.entries(values)) $(id).value = value || "";
          $("identityConfirmed").checked = false;
          $("identityReview").style.display = "block";
          $("identityStatus").textContent = `${result.engine} · OCR confidence ${result.confidence}% · ${result.mrz.detected ? `${result.mrz.format || "MRZ"} ${result.mrz.valid ? "validated" : "requires review"}` : "MRZ not detected — review required"}`;
        } catch (error) {
          identityExtractionToken = null;
          $("identityReview").style.display = "none";
          $("clientErr").textContent = error.message;
          $("identityStatus").textContent = "Identity extraction failed.";
        }
      }
      async function confirmIdentityAutofill() {
        $("clientErr").textContent = "";
        if (!identityExtractionToken) return ($("clientErr").textContent = "Upload and extract an identity document first.");
        if (!$("identityConfirmed").checked) return ($("clientErr").textContent = "Human review confirmation is required.");
        const fields = {
          legal_name: $("identityLegalName").value.trim(),
          date_of_birth: $("identityDob").value || null,
          place_of_birth: $("identityBirthPlace").value.trim() || null,
          nationality: $("identityNationality").value.trim() || null,
          passport_number: $("identityNumber").value.trim() || null,
          passport_country: $("identityCountry").value.trim() || null,
          passport_expiration: $("identityExpiration").value || null,
        };
        if (!fields.legal_name) return ($("clientErr").textContent = "Reviewed legal name is required.");
        for (const [id, value] of Object.entries({
          clientLegalName: fields.legal_name, clientDob: fields.date_of_birth,
          clientBirthPlace: fields.place_of_birth, clientNationality: fields.nationality,
          clientPassport: fields.passport_number, clientPassportExpiration: fields.passport_expiration,
        })) $(id).value = value || "";
        try {
          await api("/api/v1/identity/confirm", {
            method: "POST",
            body: JSON.stringify({ extraction_token: identityExtractionToken, client_id: $("editClientId").value || null, fields, confirmed: true }),
          });
          closeClient();
          await loadClients();
        } catch (error) { $("clientErr").textContent = error.message; }
      }
      async function saveClient() {
        const id = $("editClientId").value;
        const body = {
          legal_name: $("clientLegalName").value.trim(),
          legal_name_ar: $("clientLegalNameAr").value.trim() || null,
          date_of_birth: $("clientDob").value || null,
          place_of_birth: $("clientBirthPlace").value.trim() || null,
          nationality: $("clientNationality").value.trim() || null,
          current_country: $("clientCountry").value.trim() || null,
          email: $("clientEmail").value.trim() || null,
          phone: $("clientPhone").value.trim() || null,
          whatsapp: $("clientWhatsapp").value.trim() || null,
          preferred_language: $("clientLanguage").value.trim() || "English",
          a_number: $("clientANumber").value.trim() || null,
          uscis_account_number: $("clientUscisNumber").value.trim() || null,
          passport_number: $("clientPassport").value.trim() || null,
          passport_expiration: $("clientPassportExpiration").value || null,
          physical_address: $("clientAddress").value.trim() || null,
          postal_code: $("clientPostal").value.trim() || null,
          immigration_status: $("clientImmigrationStatus").value.trim() || null,
          operational_notes: $("clientNotes").value.trim() || null,
        };
        if (!body.legal_name) return ($("clientErr").textContent = "Legal name is required.");
        try {
          await api(id ? "/api/v1/clients/" + id : "/api/v1/clients", {
            method: id ? "PATCH" : "POST",
            body: JSON.stringify(body),
          });
          closeClient();
          await loadClients();
        } catch (error) {
          $("clientErr").textContent = error.message;
        }
      }
      function fillCaseSelect() {
        $("docCase").innerHTML = cases
          .map(
            (c) =>
              `<option value="${c.id}">${esc(c.client_name)} — ${esc(c.case_type)}</option>`,
          )
          .join("");
        if ($("taskCase")) {
          $("taskCase").innerHTML =
            '<option value="">Select case</option>' +
            cases.map((c) => `<option value="${c.id}">${esc(c.client_name)} — ${esc(c.case_type)}</option>`).join("");
        }
      }
      async function openCase(type = "", serviceCode = "") {
        await Promise.all([loadViewData("services"), loadViewData("clients")]);
        caseModalTitle.textContent = "Create New Case";
        $("editCaseId").value = "";
        $("selectedServiceCode").value = serviceCode;
        $("caseClientSelect").value = "";
        $("clientName").value = "";
        $("caseType").value = type || services[0]?.name || "";
        $("caseStatus").value = "intake";
        $("priority").value = "normal";
        $("assigned").value = "";
        $("notes").value = "";
        $("caseErr").textContent = "";
        $("caseModal").classList.add("show");
      }
      function openCaseEditor(id) {
        const c = cases.find((x) => x.id === id);
        if (!c) return;
        caseModalTitle.textContent = "Edit Case";
        $("editCaseId").value = id;
        $("selectedServiceCode").value = c.service_code || "";
        $("caseClientSelect").value = c.client_id || "";
        $("clientName").value = c.client_name;
        $("caseType").value = c.case_type;
        $("caseStatus").value = c.status;
        $("priority").value = c.priority;
        $("assigned").value = c.assigned_to || "";
        $("notes").value = c.notes || "";
        $("caseErr").textContent = "";
        $("caseModal").classList.add("show");
      }
      const workspaceRows=(items,renderItem,empty=tr("noRecords"))=>(items||[]).map(renderItem).join("")||`<div class="empty">${esc(empty)}</div>`;
      async function editCase(id){
        try{
          const result=await api(`/api/v1/cases/${id}/workspace`),workspace=result.data,c=workspace.case,client=workspace.client||{};
          const initials=String(client.legal_name||c.client_name||"A").split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase();
          $("workspaceAvatar").innerHTML=client.profile_photo_url?`<img src="${esc(client.profile_photo_url)}" alt="">`:esc(initials);
          $("workspaceClientName").textContent=currentLanguage==="Arabic"&&client.legal_name_ar?client.legal_name_ar:(client.legal_name||c.client_name||"—");
          $("workspaceClientNumber").textContent=client.client_number||"—";
          $("workspaceCaseNumber").textContent=c.case_number||c.case_reference||"—";
          $("workspaceService").textContent=c.case_type||c.service_code||"—";
          $("workspaceStatus").textContent=intakeOptionLabel(c.workflow_stage||c.status);
          $("workspacePriority").textContent=intakeOptionLabel(c.priority);
          $("workspaceStage").textContent=intakeOptionLabel(c.workflow_stage||"intake");
          $("workspaceAssigned").textContent=c.assigned_to||workspace.assignments?.[0]?.auth_user_id||"—";
          $("workspaceLatest").textContent=workspace.latest_activity?`${intakeOptionLabel(workspace.latest_activity.event_type)} · ${date(workspace.latest_activity.created_at)}`:"—";
          $("workspaceDeadline").textContent=workspace.deadlines?.find(item=>item.status==="open")?.deadline_date||"—";
          $("workspaceBalance").textContent=workspace.financial_summary?money(workspace.financial_summary.balance_cents):"—";
          $("workspaceEditButton").dataset.a1=id;
          const summary=(label,value)=>`<div class="workspace-stat"><span>${esc(label)}</span><b>${esc(value||"—")}</b></div>`;
          $("workspace-overview").innerHTML=`<div class="workspace-summary">${summary(tr("caseNumber"),c.case_number||c.case_reference)}${summary(tr("clientNumber"),client.client_number)}${summary(tr("service"),c.case_type)}${summary(tr("currentStatus"),intakeOptionLabel(c.workflow_stage||c.status))}${summary(tr("latestActivity"),workspace.latest_activity?intakeOptionLabel(workspace.latest_activity.event_type):"—")}${summary(tr("outstandingBalance"),workspace.financial_summary?money(workspace.financial_summary.balance_cents):"—")}</div><div class="workspace-note">${esc(c.notes||tr("noRecords"))}</div>`;
          $("workspace-journey").innerHTML=workspaceRows(workspace.timeline,item=>`<div class="timeline-item"><span></span><div><b>${esc(intakeOptionLabel(item.event_type))}</b><p>${esc(item.actor||"System")} · ${date(item.created_at)}</p></div></div>`);
          $("workspace-profile").innerHTML=`<div class="workspace-summary">${summary(tr("clientNumber"),client.client_number)}${summary(tr("displayName"),client.legal_name)}${summary("الاسم بالعربية / Arabic name",client.legal_name_ar)}${summary("A-Number",client.a_number)}${summary("Passport",client.passport_number)}${summary("USCIS Account",client.uscis_account_number)}${summary("Email",client.email)}${summary("Phone",client.phone)}${summary(tr("preferredLanguage"),client.preferred_language)}</div>`;
          $("workspace-intake").innerHTML=workspaceRows(workspace.intakes,item=>`<div class="workspace-card"><b>${esc(item.status)}</b><span>${date(item.updated_at)}</span><small>${Object.keys(item.answers||{}).length} fields</small></div>`);
          $("workspace-documents").innerHTML=workspaceRows(workspace.documents,item=>`<div class="workspace-card"><b>${esc(item.file_name)}</b><span>${esc(item.category||"Unclassified")} · ${esc(item.review_status)}</span><small>${date(item.created_at)}</small></div>`);
          $("workspace-actions").innerHTML=workspaceRows(workspace.document_requests,item=>`<div class="workspace-card"><b>${esc(item.title)}</b><span>${esc(item.status)}${item.due_date?` · ${esc(item.due_date)}`:""}</span><small>${esc(item.instructions||"")}</small></div>`);
          $("workspace-tasks").innerHTML=workspaceRows(workspace.tasks,item=>`<div class="workspace-card"><b>${esc(item.title)}</b><span>${esc(item.status)} · ${esc(item.priority)}</span><small>${esc(item.due_date||"—")}</small></div>`);
          $("workspace-deadlines").innerHTML=workspaceRows(workspace.deadlines,item=>`<div class="workspace-card"><b>${esc(item.title)}</b><span>${esc(item.deadline_date)} · ${esc(item.status)}</span><small>${esc(item.deadline_type||"")}</small></div>`);
          $("workspace-appointments").innerHTML=workspaceRows(workspace.appointments,item=>`<div class="workspace-card"><b>${esc(item.title)}</b><span>${date(item.starts_at)}</span><small>${esc(item.location||"")}</small></div>`);
          $("workspace-communications").innerHTML=workspaceRows([...(workspace.communications||[]),...(workspace.messages||[])],item=>`<div class="workspace-card"><b>${esc(item.subject||intakeOptionLabel(item.sender_type||item.template_key||"Message"))}</b><span>${esc(item.status||"")} · ${date(item.created_at||item.queued_at)}</span><small>${esc(item.recipient||item.body||"")}</small></div>`);
          $("workspace-billing").innerHTML=workspace.financial_summary?`<div class="workspace-summary">${summary("Total fee",money(workspace.financial_summary.total_fee_cents))}${summary("Paid",money(workspace.financial_summary.paid_cents))}${summary(tr("outstandingBalance"),money(workspace.financial_summary.balance_cents))}</div>${workspaceRows(workspace.invoices,item=>`<div class="workspace-card"><b>${esc(item.invoice_number)}</b><span>${esc(item.status)}</span><small>${esc(item.due_date||"—")}</small></div>`)}`:`<div class="empty">${esc(tr("noRecords"))}</div>`;
          $("workspace-notes").innerHTML=workspaceRows(workspace.notes,item=>`<div class="workspace-card"><b>${esc(intakeOptionLabel(item.visibility))}</b><span>${date(item.created_at)}</span><small>${esc(item.body)}</small></div>`);
          $("workspace-team").innerHTML=`<h3>${esc(tr("assigned"))}</h3>${workspaceRows(workspace.assignments,item=>`<div class="workspace-card"><b>${esc(item.assignment_role)}</b><span>${esc(item.auth_user_id)}</span></div>`)}<h3>${esc(tr("communications"))}</h3>${workspaceRows(workspace.messages,item=>`<div class="workspace-card"><b>${esc(item.sender_type)}</b><span>${date(item.created_at)}</span><small>${esc(item.body)}</small></div>`)}`;
          $("workspace-audit").innerHTML=workspaceRows(workspace.audit?.length?workspace.audit:workspace.timeline,item=>`<div class="workspace-card"><b>${esc(intakeOptionLabel(item.action||item.event_type))}</b><span>${esc(item.actor_label||item.actor||"System")} · ${date(item.created_at)}</span></div>`);
          switchWorkspaceTab("overview");applyTranslations();$("caseWorkspaceModal").classList.add("show");
        }catch(error){alert(error.message)}
      }
      function switchWorkspaceTab(tab){
        document.querySelectorAll(".workspace-tab").forEach(button=>button.classList.toggle("active",button.dataset.a1===tab));
        document.querySelectorAll(".workspace-panel").forEach(panel=>panel.classList.toggle("active",panel.id===`workspace-${tab}`));
      }
      function closeCaseWorkspace(){$("caseWorkspaceModal").classList.remove("show")}
      function closeCase() {
        $("caseModal").classList.remove("show");
      }
      async function saveCase() {
        const id = $("editCaseId").value,
          b = {
            client_id: $("caseClientSelect").value || null,
            client_name: $("clientName").value.trim(),
            service_code: $("selectedServiceCode").value || null,
            case_type: $("caseType").value,
            status: $("caseStatus").value,
            priority: $("priority").value,
            assigned_to: $("assigned").value.trim() || null,
            notes: $("notes").value.trim() || null,
          };
        if (!b.client_id && !b.client_name)
          return ($("caseErr").textContent = "Select a client or enter the client name.");
        try {
          const result = await api(id ? "/api/v1/cases/" + id : "/api/v1/cases", {
            method: id ? "PATCH" : "POST",
            body: JSON.stringify(b),
          });
          const created = Array.isArray(result.data) ? result.data[0] : result.data;
          closeCase();
          await loadCases();
          if (!id && b.service_code && created?.id) await openIntake(created.id, b.service_code);
          else showView("cases");
        } catch (e) {
          $("caseErr").textContent = e.message;
        }
      }
      async function loadTasks() {
        const filter = $("taskFilter")?.value || "";
        const statuses = new Set(["open","in_progress","blocked","completed"]);
        try {
          const result = await api("/api/v1/tasks?limit=250" + (statuses.has(filter) ? "&status=" + encodeURIComponent(filter) : "") + (filter === "my" ? "&assigned_to=me" : ""));
          tasks = result.data || [];
          renderTasks(filter);
          renderMetrics();
        } catch (error) {
          $("taskTable").innerHTML =
            '<tr><td colspan="6">Unable to load task records.</td></tr>';
        }
      }
      function renderTasks(filter = $("taskFilter")?.value || "") {
        const caseNames = Object.fromEntries(cases.map((item) => [item.id, item.client_name + " — " + item.case_type]));
        const clientNames = Object.fromEntries(clients.map((item) => [item.id, item.legal_name]));
        const today = new Date().toISOString().slice(0, 10);
        const visible = tasks.filter((task) => !filter || filter === "my" || ["open","in_progress","blocked","completed"].includes(filter) || filter === "today" && task.due_date === today || filter === "overdue" && task.due_date && task.due_date < today && task.status !== "completed" || filter === "upcoming" && task.due_date && task.due_date > today && task.status !== "completed");
        $("taskTable").innerHTML =
          visible.map((task) => {
            const overdue = task.due_date && task.due_date < today && task.status !== "completed";
            return `<tr><td><b>${esc(task.title)}</b></td><td>${esc(caseNames[task.case_id] || clientNames[task.client_id] || "—")}</td><td>${esc(task.due_date || "—")}${overdue ? ' <span class="tag urgent">Overdue</span>' : ""}</td><td><span class="tag ${esc(task.priority)}">${esc(task.priority)}</span></td><td>${esc(task.status)}</td><td><button class="linkbtn" data-act="editTask" data-a1="${task.id}">Edit</button></td></tr>`;
          }).join("") || '<tr><td colspan="6">No tasks in this view.</td></tr>';
      }
      function openTask() {
        $("taskModalTitle").textContent = "Create Task";
        $("editTaskId").value = "";
        $("taskTitle").value = "";
        $("taskCase").value = "";
        $("taskClient").value = "";
        $("taskAssignee").value = currentUser?.id || "";
        $("taskDue").value = "";
        $("taskPriority").value = "normal";
        $("taskStatus").value = "open";
        $("taskDescription").value = "";
        $("taskErr").textContent = "";
        $("taskModal").classList.add("show");
      }
      function editTask(id) {
        const task = tasks.find((item) => item.id === id);
        if (!task) return;
        $("taskModalTitle").textContent = "Edit Task";
        $("editTaskId").value = id;
        $("taskTitle").value = task.title || "";
        $("taskCase").value = task.case_id || "";
        $("taskClient").value = task.client_id || "";
        $("taskAssignee").value = task.assigned_user_id || "";
        $("taskDue").value = task.due_date || "";
        $("taskPriority").value = task.priority;
        $("taskStatus").value = task.status;
        $("taskDescription").value = task.description || "";
        $("taskErr").textContent = "";
        $("taskModal").classList.add("show");
      }
      function closeTask() {
        $("taskModal").classList.remove("show");
      }
      async function saveTask() {
        const id = $("editTaskId").value;
        const body = {
          title: $("taskTitle").value.trim(),
          case_id: $("taskCase").value || null,
          client_id: $("taskClient").value || null,
          assigned_user_id: $("taskAssignee").value || null,
          due_date: $("taskDue").value || null,
          priority: $("taskPriority").value,
          status: $("taskStatus").value,
          description: $("taskDescription").value.trim() || null,
        };
        if (!body.title) return ($("taskErr").textContent = "Task title is required.");
        if (!body.case_id && !body.client_id) return ($("taskErr").textContent = "Select a case or client.");
        try {
          await api(id ? "/api/v1/tasks/" + id : "/api/v1/tasks", {
            method: id ? "PATCH" : "POST",
            body: JSON.stringify(body),
          });
          closeTask();
          await loadTasks();
        } catch (error) {
          $("taskErr").textContent = error.message;
        }
      }
      function intakeFieldVisible(field) {
        if (!field.visibleWhen) return true;
        return intakeState.answers[field.visibleWhen.field] === field.visibleWhen.equals;
      }
      const intakeArabic=Object.freeze({
        capacity:"صفة مقدم البيانات",legal_name:"الاسم القانوني",date_of_birth:"تاريخ الميلاد",place_of_birth:"مكان الميلاد",nationality:"الجنسية",current_country:"بلد الإقامة الحالي",email:"البريد الإلكتروني",phone:"الهاتف أو واتساب",us_status:"الوضع الحالي في الولايات المتحدة",a_number:"رقم الأجنبي A-Number",petitioner_status:"وضع مقدم الالتماس",relationship:"صلة القرابة",beneficiary_location:"موقع المستفيد داخل أو خارج الولايات المتحدة",prior_petitions:"الالتماسات السابقة للمستفيد",entry_method:"طريقة الدخول الأخيرة",i94_number:"رقم I-94",underlying_basis:"أساس تعديل الوضع",court_proceedings:"إجراءات الترحيل الحالية أو السابقة",sponsor_household_size:"حجم أسرة الكفيل",sponsor_income:"الدخل السنوي الحالي للأسرة",tax_years_available:"سنوات الإقرارات الضريبية المتاحة",joint_sponsor_needed:"استخدام كفيل مشترك",household_member_relationship:"صلة فرد الأسرة بالكفيل",same_residence:"إقامة فرد الأسرة مع الكفيل",member_income:"الدخل السنوي لفرد الأسرة",eligibility_category:"فئة الأهلية المطلوبة",prior_ead:"تصريح عمل سابق",current_ead_expiration:"تاريخ انتهاء تصريح العمل الحالي",document_type:"نوع المستند",planned_departure:"تاريخ المغادرة المخطط",travel_purpose:"غرض السفر",filing_basis:"أساس التقديم",card_expiration:"تاريخ انتهاء البطاقة",living_together:"إقامة الزوجين معًا حاليًا",resident_since:"مقيم دائم منذ",travel_over_six_months:"رحلة خارج الولايات المتحدة لستة أشهر أو أكثر",arrests_or_citations:"توقيف أو مخالفة أو اتهام أو إدانة",tax_compliance:"تقديم جميع الإقرارات الضريبية المطلوبة",replacement_reason:"سبب الطلب",nvc_case_number:"رقم ملف NVC",invoice_id:"رقم تعريف الفاتورة",intended_us_address:"العنوان المقصود في الولايات المتحدة",prior_us_travel:"سفر سابق إلى الولايات المتحدة",ceac_stage:"مرحلة CEAC الحالية",petitioner_domicile:"دليل موطن مقدم الالتماس في الولايات المتحدة",petition_receipt:"رقم إيصال الالتماس المعتمد",consulate:"السفارة أو القنصلية المحددة",case_stage:"مرحلة الملف الحالية",in_person_meeting:"لقاء الطرفين شخصيًا خلال العامين السابقين",meeting_date:"تاريخ آخر لقاء شخصي",prior_marriages_ended:"انتهاء جميع الزيجات السابقة قانونًا",last_arrival_date:"تاريخ آخر وصول إلى الولايات المتحدة",one_year_issue:"بدء الطلب بعد أكثر من سنة من الوصول",protected_ground:"أساس الحماية المدعى",court_case:"وجود الملف حاليًا في محكمة الهجرة",next_hearing:"تاريخ الجلسة القادمة",court_location:"موقع محكمة الهجرة",represented:"وجود محامٍ أو ممثل معتمد مسجل",notice_to_appear:"استلام إشعار الحضور",prior_removal_order:"أمر ترحيل سابق",facility:"مرفق الاحتجاز",detainee_a_number:"رقم A للمحتجز",bond_hearing:"جلسة كفالة مجدولة",decision_date:"تاريخ القرار",appeal_deadline:"موعد الاستئناف المبين في القرار",written_decision:"توفر القرار المكتوب",final_order_date:"تاريخ الأمر النهائي",motion_basis:"أساس إعادة الفتح",prior_motion:"طلب سابق لإعادة الفتح",claimed_error:"الخطأ القانوني أو الواقعي المدعى",inadmissibility_ground:"سبب عدم القبول الذي حددته الحكومة",qualifying_relative:"القريب المؤهل",prior_denial:"رفض سابق لتأشيرة أو منفعة",approved_petition:"اعتماد الالتماس الأساسي",nvc_fee_paid:"دفع رسوم تأشيرة الهجرة إلى NVC",removal_proceedings:"إجراءات ترحيل حالية أو سابقة",abuser_status:"وضع المعتدي في الهجرة",relationship_to_abuser:"العلاقة بالمعتدي",safe_contact_method:"طريقة التواصل الآمنة",qualifying_crime:"النشاط الجرمي المؤهل المبلغ عنه",law_enforcement_agency:"جهة إنفاذ القانون المصدقة",certification_status:"حالة ملحق I-918 B",trafficking_type:"نوع الاتجار",law_enforcement_contact:"التواصل مع جهة إنفاذ القانون",physical_presence:"الحضور الفعلي المرتبط بالاتجار",child_age:"عمر الطفل",state_court_order:"الحصول على أمر محكمة ولاية مؤهل",marital_status:"الحالة الزوجية للطفل",designated_country:"الدولة المعينة لـ TPS",continuous_residence_date:"تاريخ بدء الإقامة المستمرة",prior_tps:"تسجيل TPS سابق",passport_country:"دولة الجواز",passport_expiration:"تاريخ انتهاء الجواز",renewal_location:"دولة تجديد الجواز",source_language:"لغة المصدر",target_language:"اللغة الهدف",document_count:"عدد المستندات",signer_count:"عدد الموقعين",signers_have_id:"حيازة جميع الموقعين لهوية سارية",principal_location:"موقع الموكل",agent_location:"موقع الوكيل",authority_scope:"نطاق الصلاحية المطلوبة",departure_city:"مدينة المغادرة",destination_city:"مدينة الوصول",travel_date:"تاريخ السفر",passenger_count:"عدد المسافرين",family_members:"أفراد العائلة",referred:"إحالة من شخص أو مكتب",referrer_name:"اسم المحيل",
        applicant:"مقدم الطلب",petitioner:"مقدم الالتماس",beneficiary:"المستفيد",authorized_contact:"جهة اتصال مخولة",outside_us:"خارج الولايات المتحدة",inside_us:"داخل الولايات المتحدة",us_citizen:"مواطن أمريكي",permanent_resident:"مقيم دائم",nonimmigrant:"غير مهاجر",parole:"إفراج مشروط",asylum_or_refugee:"لجوء أو صفة لاجئ",no_current_status:"دون وضع حالي",unknown:"غير معروف",spouse:"زوج أو زوجة",child:"طفل",parent:"والد أو والدة",sibling:"أخ أو أخت",other:"أخرى",inspected_admitted:"دخول بعد تفتيش وقبول",paroled:"دخول بإفراج مشروط",without_inspection:"دخول دون تفتيش",family:"عائلي",employment:"عمل",humanitarian:"إنساني",latest:"الأحدث",previous_1:"السنة السابقة",previous_2:"السنة التي قبلها",advance_parole:"إذن سفر مسبق",reentry_permit:"تصريح إعادة دخول",refugee_travel_document:"وثيقة سفر للاجئ",joint:"مشترك",divorce_waiver:"إعفاء بسبب الطلاق",abuse_waiver:"إعفاء بسبب الإساءة",extreme_hardship:"مشقة شديدة",expired_or_expiring:"منتهية أو قاربت الانتهاء",lost_stolen_destroyed:"مفقودة أو مسروقة أو تالفة",incorrect_data:"بيانات غير صحيحة",name_change:"تغيير الاسم",never_received:"لم تُستلم",fees:"الرسوم",ds260:"DS-260",civil_documents:"المستندات المدنية",affidavit_of_support:"إقرار الدعم",documentarily_qualified:"مؤهل مستنديًا",interview:"المقابلة",race:"العرق",religion:"الدين",political_opinion:"الرأي السياسي",particular_social_group:"فئة اجتماعية معينة",adult_child:"ابن أو ابنة بالغة",not_requested:"لم يُطلب",requested:"مطلوب",signed:"موقع",declined:"مرفوض",labor:"عمل قسري",sex:"استغلال جنسي",both:"كلاهما",unmarried:"غير متزوج",married:"متزوج",other_dependent:"معال آخر",yes:"نعم",no:"لا",true:"نعم",false:"لا"
      });
      function intakeOptionLabel(value) {
        const arabicLabels = {
          active: "نشط", archived: "مؤرشف", assigned: "مُسند", cancelled: "ملغي",
          completed: "مكتمل", draft: "مسودة", due: "مستحق", failed: "فشل",
          in_progress: "قيد التنفيذ", invited: "مدعو", needs_review: "يحتاج مراجعة",
          not_applicable: "غير منطبق", open: "مفتوح", overdue: "متأخر", paid: "مدفوع",
          pending: "قيد الانتظار", queued: "في قائمة الانتظار", rejected: "مرفوض",
          requested: "مطلوب", reviewed: "تمت المراجعة", sent: "مُرسل", verified: "موثّق",
        };
        if (currentLanguage === "Arabic" && (arabicLabels[value]||intakeArabic[value])) return arabicLabels[value]||intakeArabic[value];
        return String(value || "")
          .replaceAll("_", " ")
          .replace(/\b\w/g, (letter) => letter.toUpperCase());
      }
      function intakeFieldLabel(field){return currentLanguage==="Arabic"?(intakeArabic[field.id]||translatedUiPhrase(field.label)):field.label;}
      function intakeSectionLabel(section){if(currentLanguage!=="Arabic")return section.title;return ({identity:"الهوية وبيانات الاتصال",family_members:"أفراد العائلة في هذا الملف",service_details:`تفاصيل خدمة ${intakeState?.serviceCode||""}`,referral:"الإحالة"})[section.id]||translatedUiPhrase(section.title);}
      function intakeInput(field) {
        const value = intakeState.answers[field.id];
        const required = field.required ? " required" : "";
        const common = `id="intake_${esc(field.id)}" data-intake-field="${esc(field.id)}"${required}`;
        if (field.type === "textarea")
          return `<textarea ${common}>${esc(value || "")}</textarea>`;
        if (field.type === "select")
          return `<select ${common}><option value="">${esc(currentLanguage==="Arabic"?"اختر":"Select")}</option>${(field.options || []).map((option) => `<option value="${esc(option)}"${value === option ? " selected" : ""}>${esc(intakeOptionLabel(option))}</option>`).join("")}</select>`;
        if (field.type === "yes_no")
          return `<select ${common}><option value="">${esc(currentLanguage==="Arabic"?"اختر":"Select")}</option><option value="true"${value === true ? " selected" : ""}>${esc(intakeOptionLabel("yes"))}</option><option value="false"${value === false ? " selected" : ""}>${esc(intakeOptionLabel("no"))}</option></select>`;
        if (field.type === "multi_select")
          return `<div class="intake-options">${(field.options || []).map((option) => `<label><input type="checkbox" data-intake-multi="${esc(field.id)}" value="${esc(option)}"${Array.isArray(value) && value.includes(option) ? " checked" : ""}> ${esc(intakeOptionLabel(option))}</label>`).join("")}</div>`;
        if (field.type === "repeatable_people") return renderPeopleField(field);
        const types = { email: "email", phone: "tel", date: "date", number: "number", currency: "number" };
        const inputMode = field.type === "currency" ? ' step="0.01" min="0"' : field.type === "number" ? ' step="1"' : "";
        return `<input ${common} type="${types[field.type] || "text"}" value="${esc(value ?? "")}"${inputMode} autocomplete="off">`;
      }
      function renderPeopleField(field) {
        const people = Array.isArray(intakeState.answers[field.id]) ? intakeState.answers[field.id] : [];
        return `<div class="people-list">${people.map((person, index) => `<div class="panel" style="margin:10px 0;padding:15px"><div class="ph"><b>${esc(currentLanguage==="Arabic"?`فرد العائلة ${index+1}`:`Family member ${index+1}`)}</b><button class="linkbtn" type="button" data-act="removeIntakePerson" data-a1="${esc(field.id)}" data-a2="${index}">${esc(currentLanguage==="Arabic"?"إزالة":"Remove")}</button></div><div class="form">${field.personFields.map((personField) => `<div class="field"><label>${esc(intakeFieldLabel(personField))}${personField.required ? " *" : ""}</label>${personField.type === "select" ? `<select data-person-group="${esc(field.id)}" data-person-index="${index}" data-person-field="${esc(personField.id)}"><option value="">${esc(currentLanguage==="Arabic"?"اختر":"Select")}</option>${personField.options.map((option) => `<option value="${esc(option)}"${person[personField.id] === option ? " selected" : ""}>${esc(intakeOptionLabel(option))}</option>`).join("")}</select>` : `<input type="${personField.type === "date" ? "date" : "text"}" data-person-group="${esc(field.id)}" data-person-index="${index}" data-person-field="${esc(personField.id)}" value="${esc(person[personField.id] || "")}" autocomplete="off">`}</div>`).join("")}</div></div>`).join("")}<button class="btn" type="button" data-act="addIntakePerson" data-a1="${esc(field.id)}">${esc(currentLanguage==="Arabic"?"إضافة فرد من العائلة":"Add family member")}</button></div>`;
      }
      function bindIntakeFields() {
        document.querySelectorAll("[data-intake-field]").forEach((input) =>
          input.addEventListener("input", () => {
            let value = input.value;
            if (input.querySelector?.('option[value="true"]')) value = value === "" ? "" : value === "true";
            intakeState.answers[input.dataset.intakeField] = value;
            scheduleIntakeSave();
            const section = intakeState.definition.sections[intakeState.step];
            if (section?.fields.some((item) => item.visibleWhen?.field === input.dataset.intakeField)) renderIntake();
          }),
        );
        document.querySelectorAll("[data-intake-multi]").forEach((input) =>
          input.addEventListener("change", () => {
            intakeState.answers[input.dataset.intakeMulti] = [...document.querySelectorAll(`[data-intake-multi="${CSS.escape(input.dataset.intakeMulti)}"]:checked`)].map((item) => item.value);
            scheduleIntakeSave();
          }),
        );
        document.querySelectorAll("[data-person-group]").forEach((input) =>
          input.addEventListener("input", () => {
            const people = intakeState.answers[input.dataset.personGroup] || [];
            people[Number(input.dataset.personIndex)][input.dataset.personField] = input.value;
            scheduleIntakeSave();
          }),
        );
      }
      function addIntakePerson(fieldId) {
        const field = intakeState.definition.sections.flatMap((section) => section.fields).find((item) => item.id === fieldId);
        const people = intakeState.answers[fieldId] || [];
        if (people.length >= (field.maxItems || 20)) return;
        people.push({});
        intakeState.answers[fieldId] = people;
        renderIntake();
        scheduleIntakeSave();
      }
      function removeIntakePerson(fieldId, index) {
        intakeState.answers[fieldId].splice(index, 1);
        renderIntake();
        scheduleIntakeSave();
      }
      async function openIntake(caseId, serviceCode, portal = false) {
        try {
          const endpoint = portal ? `/api/v1/portal/intakes/${caseId}/${encodeURIComponent(serviceCode)}` : `/api/v1/intakes/${caseId}/${encodeURIComponent(serviceCode)}`;
          const result = await api(endpoint);
          intakeState = {
            caseId,
            serviceCode,
            definition: result.definition,
            answers: result.data?.answers || {},
            step: Math.min(result.data?.current_step || 0, result.definition.sections.length - 1),
            review: result.data?.status === "submitted",
            portal,
            endpoint,
          };
          $("intakeErr").textContent = "";
          $("intakeModal").classList.add("show");
          renderIntake();
        } catch (error) {
          alert(error.message);
        }
      }
      function renderIntake() {
        if (!intakeState) return;
        const sections = intakeState.definition.sections;
        $("intakeTitle").textContent = currentLanguage==="Arabic"?`استقبال خدمة ${intakeState.serviceCode}`:`${intakeState.serviceCode} Intake`;
        if (intakeState.review) {
          $("intakeProgress").textContent = currentLanguage==="Arabic"?"مراجعة قبل الإرسال":"Review before submit";
          $("intakeFields").innerHTML = `<div class="panel"><h3>${esc(currentLanguage==="Arabic"?"تأكيد المعلومات":"Confirm the information")}</h3><p class="muted">${esc(currentLanguage==="Arabic"?"راجع كل قسم. استخدم تعديل لتصحيح المعلومات قبل الإرسال.":"Review every section. Use Edit to correct information before submitting.")}</p>${sections.map((section, index) => `<div class="sysrow"><div><b>${esc(intakeSectionLabel(section))}</b><small style="display:block;color:var(--muted);margin-top:5px">${section.fields.filter(intakeFieldVisible).map((field) => `${esc(intakeFieldLabel(field))}: ${esc(formatIntakeAnswer(intakeState.answers[field.id]))}`).join(" · ") || esc(currentLanguage==="Arabic"?"لم تُدخل معلومات":"No information entered")}</small></div><button class="linkbtn" data-act="editIntakeStep" data-a1="${index}">${esc(tr("edit"))}</button></div>`).join("")}</div>`;
          $("intakeBack").style.display = "inline-block";
          $("intakeNext").textContent = currentLanguage==="Arabic"?"إرسال بيانات الاستقبال":"Submit Intake";
          bindIntakeFields();
          return;
        }
        const section = sections[intakeState.step];
        $("intakeProgress").textContent = currentLanguage==="Arabic"?`الخطوة ${intakeState.step+1} من ${sections.length}`:`Step ${intakeState.step + 1} of ${sections.length}`;
        const sectionDescription=currentLanguage==="Arabic"&&section.id==="family_members"?"أضف فقط الأشخاص المرتبطين بهذا الطلب. يمكنك إضافة شخص أو إزالته قبل الإرسال.":section.description;
        $("intakeFields").innerHTML = `<h3>${esc(intakeSectionLabel(section))}</h3>${sectionDescription ? `<p class="muted">${esc(sectionDescription)}</p>` : ""}<div class="form">${section.fields.filter(intakeFieldVisible).map((field) => `<div class="field ${field.type === "textarea" || field.type === "multi_select" || field.type === "repeatable_people" ? "full" : ""}"><label>${esc(intakeFieldLabel(field))}${field.required ? " *" : ""}</label>${intakeInput(field)}</div>`).join("")}</div>`;
        $("intakeBack").style.display = intakeState.step ? "inline-block" : "none";
        $("intakeNext").textContent = intakeState.step === sections.length - 1 ? (currentLanguage==="Arabic"?"مراجعة":"Review") : (currentLanguage==="Arabic"?"التالي":"Next");
        bindIntakeFields();
      }
      function formatIntakeAnswer(value) {
        if (value === true) return intakeOptionLabel("yes");
        if (value === false) return intakeOptionLabel("no");
        if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "object" ? item.legal_name || (currentLanguage==="Arabic"?"فرد من العائلة":"Family member") : intakeOptionLabel(item)).join(", ") : "—";
        return value ? intakeOptionLabel(value) : "—";
      }
      function validateIntakeStep() {
        const section = intakeState.definition.sections[intakeState.step];
        const missing = [];
        for (const field of section.fields.filter(intakeFieldVisible)) {
          const value = intakeState.answers[field.id];
          if (field.required && (value === undefined || value === null || value === "")) missing.push(field.label);
          if (field.type === "repeatable_people") {
            for (const [index, person] of (value || []).entries()) for (const personField of field.personFields.filter((item) => item.required)) if (!person[personField.id]) missing.push(`Family member ${index + 1}: ${personField.label}`);
          }
        }
        $("intakeErr").textContent = missing.length ? `Complete: ${missing.join(", ")}` : "";
        return !missing.length;
      }
      function editIntakeStep(step) {
        intakeState.review = false;
        intakeState.step = step;
        renderIntake();
      }
      async function nextIntakeStep() {
        if (intakeState.review) return submitIntake();
        if (!validateIntakeStep()) return;
        if (intakeState.step < intakeState.definition.sections.length - 1) intakeState.step += 1;
        else intakeState.review = true;
        await saveIntakeDraft();
        renderIntake();
      }
      function previousIntakeStep() {
        $("intakeErr").textContent = "";
        if (intakeState.review) intakeState.review = false;
        else intakeState.step = Math.max(0, intakeState.step - 1);
        renderIntake();
      }
      function scheduleIntakeSave() {
        clearTimeout(intakeSaveTimer);
        intakeSaveTimer = setTimeout(() => saveIntakeDraft(true), 700);
      }
      async function saveIntakeDraft(silent = false) {
        if (!intakeState) return;
        try {
          await api(intakeState.endpoint, { method: "POST", body: JSON.stringify({ answers: intakeState.answers, current_step: intakeState.step, status: "draft" }) });
          if (!silent) $("intakeErr").textContent = "Saved.";
        } catch (error) {
          $("intakeErr").textContent = `Save failed: ${error.message}`;
        }
      }
      async function saveAndExitIntake() {
        clearTimeout(intakeSaveTimer);
        const wasPortal = intakeState?.portal;
        await saveIntakeDraft();
        $("intakeModal").classList.remove("show");
        intakeState = null;
        if (wasPortal) await loadPortal();
        else showView("cases");
      }
      async function submitIntake() {
        try {
          const wasPortal = intakeState.portal;
          await api(intakeState.endpoint, { method: "POST", body: JSON.stringify({ answers: intakeState.answers, current_step: intakeState.step, status: "submitted" }) });
          $("intakeModal").classList.remove("show");
          intakeState = null;
          if (wasPortal) await loadPortal();
          else { await loadCases(); showView("cases"); }
        } catch (error) {
          $("intakeErr").textContent = error.message === "INTAKE_REQUIRED_FIELDS_MISSING" ? "Required information is missing. Edit the affected section before submitting." : error.message;
        }
      }
      async function loadDocuments() {
        try {
          const j = await api("/api/v1/documents");
          docs = j.data || [];
          $("docCount").textContent = docs.length;
          renderMetrics();
          const names = Object.fromEntries(
            cases.map((c) => [c.id, c.client_name]),
          );
          $("docTable").innerHTML =
            docs
              .map(
                (d) =>
                  `<tr><td><b>${esc(d.file_name)}</b></td><td>${esc(names[d.case_id] || "Unknown")}</td><td>${esc(d.content_type || "—")}</td><td>${formatSize(d.size_bytes)}</td><td>${date(d.created_at)}</td><td>${["application/pdf","image/jpeg","image/png","image/webp"].includes(d.content_type) ? `<button class="linkbtn" data-act="previewDoc" data-a1="${d.id}">Preview</button> · ` : ""}<button class="linkbtn" data-act="downloadDoc" data-a1="${d.id}">Download</button> · <button class="linkbtn" data-act="deleteDoc" data-a1="${d.id}">Delete</button></td></tr>`,
              )
              .join("") ||
            '<tr><td colspan="6">No documents uploaded.</td></tr>';
        } catch (e) {
          $("docErr").textContent = e.message;
        }
      }
      async function uploadDocument() {
        const f = selectedDocumentFile || $("docFile").files[0],
          caseId = $("docCase").value;
        $("docErr").textContent = "";
        if (!caseId || !f)
          return ($("docErr").textContent = "Select a case and file.");
        try {
          const uploadButton = $("documentUploadButton");
          uploadButton.disabled = true;
          uploadButton.textContent = "Uploading…";
          const query = new URLSearchParams({ case_id: caseId, filename: f.name, size_bytes: String(f.size) });
          if ($("docCategory").value) query.set("category", $("docCategory").value);
          await uploadWithProgress(`/api/v1/documents/upload?${query}`, f, (percent) => $("docProgress").style.width = `${percent}%`, fileContentType(f));
          clearDocumentFile();
          await loadDocuments();
        } catch (e) {
          $("docErr").textContent = e.message;
        } finally {
          $("documentUploadButton").disabled = false;
          $("documentUploadButton").textContent = "Upload Document";
        }
      }
      function uploadWithProgress(url, file, onProgress, contentType = file.type || "application/octet-stream") {
        return new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open("POST", url);
          request.setRequestHeader("content-type", contentType);
          request.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
          });
          request.addEventListener("load", () => {
            let result = null;
            try { result = JSON.parse(request.responseText || "null"); } catch {}
            request.status >= 200 && request.status < 300 ? resolve(result) : reject(new Error(result?.error || "Upload failed"));
          });
          request.addEventListener("error", () => reject(new Error("Upload failed")));
          request.send(file);
        });
      }
      function chooseDocumentFile() { $("docFile").click(); }
      function setDocumentFile(file) {
        if (!file) return;
        selectedDocumentFile = file;
        $("docPreviewName").textContent = file.name;
        $("docPreviewMeta").textContent = `${formatSize(file.size)} · ${file.type || "Unknown type"}`;
        $("docProgress").style.width = "0";
        $("docPreview").classList.add("show");
      }
      function clearDocumentFile() {
        selectedDocumentFile = null;
        $("docFile").value = "";
        $("docPreview").classList.remove("show");
        $("docProgress").style.width = "0";
      }
      async function downloadDoc(documentId) {
        try {
          const j = await api("/api/v1/documents/download-url", {
            method: "POST",
            body: JSON.stringify({ document_id: documentId }),
          });
          window.open(j.download_url, "_blank");
        } catch (e) {
          alert(e.message);
        }
      }
      async function previewDoc(documentId) {
        try {
          const j = await api("/api/v1/documents/download-url", {
            method: "POST",
            body: JSON.stringify({ document_id: documentId, disposition: "inline" }),
          });
          window.open(j.preview_url || j.download_url, "_blank", "noopener,noreferrer");
        } catch (e) {
          alert(e.message);
        }
      }
      async function deleteDoc(id) {
        if (!confirm("Move this document to the protected archive?")) return;
        try {
          await api("/api/v1/documents/" + id, { method: "DELETE" });
          await loadDocuments();
        } catch (e) {
          alert(e.message);
        }
      }
      // ---- Owner access control ------------------------------------------
      let accessData = null;
      let accessUsers = [];
      let accessCases = [];

      function titleCase(value) {
        return String(value).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
      function optionList(entries) {
        return entries.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join("");
      }
      function accessSubjectOptions(type) {
        if (type === "role") return (accessData?.roles || []).filter((r) => r !== "owner").map((r) => [r, titleCase(r)]);
        if (type === "team") return (accessData?.teams || []).map((t) => [t.id, t.name]);
        return accessUsers.map((u) => [u.id, u.display_name || u.email]);
      }
      function currentAccessPolicy() {
        const type = $("accessSubjectType").value;
        const id = $("accessSubject").value;
        return (accessData?.policies || []).find((p) => p.subject_type === type && String(p.subject_id) === String(id));
      }
      function renderAccessForm() {
        const policy = currentAccessPolicy();
        const scopes = policy?.scopes || {};
        const isClientRole = ["client_owner", "client_collaborator"].includes($("accessSubject").value);
        const fallback = isClientRole ? accessData.defaults.client : accessData.defaults.staff;
        $("accessScopes").innerHTML = (accessData?.modules || [])
          .filter((m) => m !== "dashboard")
          .map((m) => `<div class="field"><label>${esc(titleCase(m))} scope</label><select data-scope="${esc(m)}">${optionList((accessData.scopes || []).map((sc) => [sc, titleCase(sc)]))}</select></div>`)
          .join("");
        for (const select of document.querySelectorAll("[data-scope]")) select.value = scopes[select.dataset.scope] || fallback;
        for (const [id, selected] of [["accessGrants", policy?.grants || []], ["accessRestrictions", policy?.restrictions || []]]) {
          $(id).innerHTML = optionList((accessData?.permissions || []).map((perm) => [perm, perm]));
          for (const option of $(id).options) option.selected = selected.includes(option.value);
        }
        renderEffectiveAccess();
      }
      async function renderEffectiveAccess() {
        const type = $("accessSubjectType").value;
        const id = $("accessSubject").value;
        $("accessEffective").innerHTML = '<tr><td colspan="2">Select a user to preview their effective access.</td></tr>';
        if (type !== "user" || !id) return;
        try {
          const j = await api("/api/v1/access/effective/" + id);
          $("accessEffective").innerHTML = Object.entries(j.data.scopes)
            .map(([m, sc]) => `<tr><td>${esc(titleCase(m))}</td><td>${esc(titleCase(sc))}</td></tr>`)
            .join("");
        } catch (e) {
          $("accessEffective").innerHTML = `<tr><td colspan="2">${esc(e.message)}</td></tr>`;
        }
      }
      function selectedValues(id) {
        return [...$(id).selectedOptions].map((o) => o.value);
      }
      function accessSubjectLabel(type, id) {
        const match = accessSubjectOptions(type).find(([value]) => String(value) === String(id));
        return match ? match[1] : id;
      }
      function accessResourceLabel(grant) {
        if (grant.resource_type === "category") return titleCase(grant.resource_key);
        if (grant.resource_type === "service") return String(grant.resource_key);
        const list = grant.resource_type === "client" ? accessData?.clients || [] : accessCases;
        const match = list.find((r) => String(r.id) === String(grant.resource_id));
        if (!match) return grant.resource_id;
        return grant.resource_type === "client" ? match.legal_name : `${match.client_name} — ${match.case_type}`;
      }
      function renderRecordGrants() {
        $("grantTable").innerHTML =
          (accessData?.recordGrants || [])
            .map((g) => `<tr><td>${esc(titleCase(g.effect))}</td><td>${esc(accessSubjectLabel(g.subject_type, g.subject_id))}</td><td>${esc(titleCase(g.resource_type))}: ${esc(accessResourceLabel(g))}</td><td><button class="linkbtn" data-revoke="${esc(g.id)}">Revoke</button></td></tr>`)
            .join("") || '<tr><td colspan="4">No record-level overrides. Everyone follows their scope.</td></tr>';
      }
      function renderGrantForm() {
        const type = $("grantResourceType").value;
        if (type === "client")
          $("grantResource").innerHTML = optionList((accessData?.clients || []).map((c) => [c.id, c.legal_name]));
        else if (type === "category")
          $("grantResource").innerHTML = optionList((accessData?.categories || []).map((c) => [c, titleCase(c)]));
        else if (type === "service")
          $("grantResource").innerHTML = optionList((accessData?.services || []).map((s) => [s.code, `${s.code} — ${s.name}`]));
        else
          $("grantResource").innerHTML = optionList(accessCases.map((c) => [c.id, `${c.client_name} — ${c.case_type}`]));
      }
      async function loadAccess() {
        $("accessErr").textContent = "";
        try {
          const [catalogue, users, cases] = await Promise.all([
            api("/api/v1/access"),
            api("/api/v1/users").catch(() => ({ data: [] })),
            api("/api/v1/cases?limit=250").catch(() => ({ data: [] })),
          ]);
          accessData = catalogue.data;
          accessUsers = users.data || [];
          accessCases = cases.data || [];
          $("accessSubject").innerHTML = optionList(accessSubjectOptions($("accessSubjectType").value));
          $("grantSubject").innerHTML = optionList([
            ...accessUsers.map((u) => [`user:${u.id}`, u.display_name || u.email]),
            ...(accessData.teams || []).map((t) => [`team:${t.id}`, `Team ${t.name}`]),
          ]);
          $("teamMemberUser").innerHTML = optionList(accessUsers.map((u) => [u.id, u.display_name || u.email]));
          $("teamMemberTeam").innerHTML = optionList((accessData.teams || []).map((t) => [t.id, t.name]));
          renderAccessForm();
          renderGrantForm();
          renderRecordGrants();
        } catch (e) {
          $("accessErr").textContent = e.detail || e.message;
        }
      }
      async function saveAccessPolicy() {
        $("accessErr").textContent = "";
        const scopes = {};
        for (const select of document.querySelectorAll("[data-scope]")) scopes[select.dataset.scope] = select.value;
        try {
          await api("/api/v1/access/policies", {
            method: "PUT",
            body: JSON.stringify({
              subject_type: $("accessSubjectType").value,
              subject_id: $("accessSubject").value,
              grants: selectedValues("accessGrants"),
              restrictions: selectedValues("accessRestrictions"),
              scopes,
            }),
          });
          await loadAccess();
        } catch (e) {
          $("accessErr").textContent = e.detail || e.message;
        }
      }
      async function clearAccessPolicy() {
        $("accessErr").textContent = "";
        try {
          await api(`/api/v1/access/policies/${$("accessSubjectType").value}/${encodeURIComponent($("accessSubject").value)}`, { method: "DELETE" });
          await loadAccess();
        } catch (e) {
          $("accessErr").textContent = e.detail || e.message;
        }
      }
      async function applyRecordGrant() {
        $("grantErr").textContent = "";
        const [subjectType, subjectId] = $("grantSubject").value.split(":");
        try {
          const resourceType = $("grantResourceType").value;
          const keyed = resourceType === "category" || resourceType === "service";
          await api("/api/v1/access/record-grants", {
            method: "POST",
            body: JSON.stringify({
              subject_type: subjectType,
              subject_id: subjectId,
              resource_type: resourceType,
              ...(keyed
                ? { resource_key: $("grantResource").value }
                : { resource_id: $("grantResource").value }),
              effect: $("grantEffect").value,
            }),
          });
          await loadAccess();
        } catch (e) {
          $("grantErr").textContent = e.detail || e.message;
        }
      }
      async function loadAudit() {
        try {
          const j = await api("/api/v1/audit");
          $("auditTable").innerHTML =
            (j.data || [])
              .map(
                (a) =>
                  `<tr><td>${esc(a.action || a.event_type)}</td><td>${esc(a.case_id || a.entity_id || "—")}</td><td>${esc(a.actor_label || a.actor || "—")}</td><td>${date(a.created_at)}</td></tr>`,
              )
              .join("") || '<tr><td colspan="4">No audit events yet.</td></tr>';
        } catch (e) {
          $("auditTable").innerHTML =
            '<tr><td colspan="4">Unable to load audit trail.</td></tr>';
        }
      }
      async function loadServices() {
        try {
          const result = await api("/api/v1/services");
          services = result.data || [];
          renderServices();
        } catch {
          $("serviceGrid").innerHTML =
            '<div class="empty">Unable to load the service catalog.</div>';
        }
      }
      function renderServices() {
        const category = $("serviceCategory")?.value || "";
        const visible = services.filter((service) => !category || service.category === category);
        $("serviceGrid").innerHTML = visible
          .map(
            (service) =>
              `<article class="service" tabindex="0" role="button" aria-label="Start ${esc(service.name)} matter" data-act="openCase" data-a1="${esc(service.name)}" data-a2="${esc(service.code)}"><div class="eyebrow">${esc(service.category.replaceAll("_", " "))}</div><h3>${esc(service.code)} — ${esc(service.name)}</h3><p>Versioned intake and controlled case workflow.</p><span class="service-action">Open intake →</span></article>`,
          )
          .join("") || '<div class="empty">No services in this category.</div>';
        $("caseType").innerHTML = services
          .map((service) => `<option value="${esc(service.name)}">${esc(service.code)} — ${esc(service.name)}</option>`)
          .join("");
      }
      function renderRoles() {
        $("roleGrid").innerHTML = roles
          .map(
            (r) =>
              `<div class="role"><b>${esc(r[0])}</b><small>${esc(r[1])}</small></div>`,
          )
          .join("");
        $("inviteRole").innerHTML = roles
          .map((role) => `<option value="${esc(role[2])}">${esc(role[0])}</option>`)
          .join("");
      }
      async function loadReviewQueue() {
        try {
          const result = await api("/api/v1/review-queue");
          $("reviewCaseTable").innerHTML = (result.data.cases || []).map((item) => `<tr><td><b>${esc(item.case_reference || item.id)}</b></td><td>${esc(item.service_code || item.case_type)}</td><td>${esc(intakeOptionLabel(item.workflow_stage))}</td><td>${esc(intakeOptionLabel(item.review_state))}</td><td><span class="tag ${esc(item.priority)}">${esc(item.priority)}</span></td></tr>`).join("") || '<tr><td colspan="5">No cases awaiting review.</td></tr>';
          $("reviewDocumentTable").innerHTML = (result.data.documents || []).map((item) => `<tr><td><b>${esc(item.file_name)}</b></td><td>${esc(item.category || "—")}</td><td>${esc(intakeOptionLabel(item.review_status))}</td><td>${date(item.created_at)}</td><td><button class="linkbtn" data-act="reviewDocument" data-a1="${item.id}" data-a2="approved">Approve</button> · <button class="linkbtn" data-act="reviewDocument" data-a1="${item.id}" data-a2="rejected">Reject</button></td></tr>`).join("") || '<tr><td colspan="5">No documents awaiting review.</td></tr>';
          $("reviewErr").textContent = "";
        } catch (error) { $("reviewErr").textContent = error.message; }
      }
      async function reviewDocument(id, status) {
        const notes = status === "rejected" ? prompt("Reason for rejection") : "";
        if (status === "rejected" && notes === null) return;
        try {
          await api(`/api/v1/documents/${id}/review`, { method: "POST", body: JSON.stringify({ status, reviewer_notes: notes }) });
          await loadReviewQueue();
        } catch (error) { $("reviewErr").textContent = error.message; }
      }
      async function loadBilling() {
        try {
          const result = await api("/api/v1/billing/invoices"); invoices = result.data || [];
          const clientNames = Object.fromEntries(clients.map((item) => [item.id, item.legal_name]));
          $("invoiceTable").innerHTML = invoices.map((item) => { const total = Number(item.office_fee_cents) + Number(item.government_fee_cents) + Number(item.other_fee_cents); return `<tr><td><b>${esc(item.invoice_number)}</b></td><td>${esc(clientNames[item.client_id] || item.client_id)}</td><td>${money(item.office_fee_cents,item.currency)}</td><td>${money(item.government_fee_cents,item.currency)}</td><td><b>${money(total,item.currency)}</b></td><td>${esc(intakeOptionLabel(item.status))}</td></tr>`; }).join("") || '<tr><td colspan="6">No invoices created.</td></tr>';
          $("billingErr").textContent = "";
        } catch (error) { $("billingErr").textContent = error.message; }
      }
      function money(cents, currency = "USD") { return new Intl.NumberFormat(undefined,{style:"currency",currency}).format(Number(cents || 0) / 100); }
      function openInvoice() {
        $("invoiceClient").innerHTML = '<option value="">Select client</option>' + clients.map((item) => `<option value="${item.id}">${esc(item.legal_name)}</option>`).join("");
        $("invoiceCase").innerHTML = '<option value="">No case</option>' + cases.map((item) => `<option value="${item.id}">${esc(item.client_name)} — ${esc(item.case_type)}</option>`).join("");
        ["invoiceOfficeFee","invoiceGovernmentFee","invoiceOtherFee","invoiceDue"].forEach((id) => $(id).value = ""); $("invoiceErr").textContent = ""; $("invoiceModal").classList.add("show");
      }
      function closeInvoice() { $("invoiceModal").classList.remove("show"); }
      async function saveInvoice() {
        const toCents = (id) => Math.round(Number($(id).value || 0) * 100);
        const body = { client_id: $("invoiceClient").value, case_id: $("invoiceCase").value || null, office_fee_cents: toCents("invoiceOfficeFee"), government_fee_cents: toCents("invoiceGovernmentFee"), other_fee_cents: toCents("invoiceOtherFee"), due_date: $("invoiceDue").value || null, currency: "USD" };
        if (!body.client_id) return ($("invoiceErr").textContent = "Select a client.");
        try { await api("/api/v1/billing/invoices", { method: "POST", body: JSON.stringify(body) }); closeInvoice(); await loadBilling(); } catch (error) { $("invoiceErr").textContent = error.message; }
      }
      async function loadReports() {
        try {
          const result = await api("/api/v1/reports/summary"), data = result.data;
          $("reportCases").textContent = data.cases.total; $("reportTasks").textContent = data.tasks.overdue; $("reportDeadlines").textContent = data.deadlines.open; $("reportDocuments").textContent = data.documents.total;
          const rows = (label, values) => `<div class="sysrow"><span>${esc(label)}</span><b>${Object.entries(values).map(([key,value]) => `${esc(intakeOptionLabel(key))}: ${value}`).join(" · ") || "None"}</b></div>`;
          $("reportDetails").innerHTML = `<div class="sys">${rows("Cases by stage",data.cases.by_stage)}${rows("Cases by priority",data.cases.by_priority)}${rows("Tasks by status",data.tasks.by_status)}${rows("Documents by review",data.documents.by_review_status)}</div>`; $("reportErr").textContent = "";
        } catch (error) { $("reportErr").textContent = error.message; }
      }
      async function loadTeam() {
        try {
          const result = await api("/api/v1/users");
          teamUsers = result.data || [];
          $("taskAssignee").innerHTML = '<option value="">Unassigned</option>' + teamUsers.filter((user) => user.status !== "inactive").map((user) => `<option value="${user.id}">${esc(user.display_name || user.email)}</option>`).join("");
          $("teamTable").innerHTML =
            teamUsers
              .map(
                (user) =>
                  `<tr><td><b>${esc(user.display_name || user.email)}</b><br><small>${esc(user.email)}</small></td><td>${esc((user.roles || []).map(intakeOptionLabel).join(", "))}</td><td>${esc(user.status)}</td><td>${date(user.last_sign_in_at)}</td><td><button class="linkbtn" data-act="openManageUser" data-a1="${user.id}">Manage</button></td></tr>`,
              )
              .join("") || '<tr><td colspan="4">No users found.</td></tr>';
        } catch (error) {
          $("taskAssignee").innerHTML = currentUser ? `<option value="${currentUser.id}">${esc(currentUser.display_name || currentUser.email)}</option>` : '<option value="">Unassigned</option>';
          $("teamTable").innerHTML =
            '<tr><td colspan="4">Unable to load authenticated users.</td></tr>';
        }
      }
      async function inviteUser() {
        const body = {
          display_name: $("inviteName").value.trim(),
          email: $("inviteEmail").value.trim(),
          roles: [$("inviteRole").value],
        };
        $("teamErr").textContent = "";
        if (!body.email) return ($("teamErr").textContent = "Email is required.");
        try {
          await api("/api/v1/users", {
            method: "POST",
            body: JSON.stringify(body),
          });
          $("inviteName").value = "";
          $("inviteEmail").value = "";
          await loadTeam();
        } catch (error) {
          $("teamErr").textContent = error.message;
        }
      }
      function openManageUser(id) {
        const user = teamUsers.find((item) => item.id === id); if (!user) return;
        $("manageUserId").value = id; $("manageUserEmail").textContent = user.email; $("manageUserStatus").value = user.status;
        $("manageUserRoles").innerHTML = roles.map((role) => `<label><input type="checkbox" data-managed-role value="${esc(role[2])}"${user.roles.includes(role[2]) ? " checked" : ""}> ${esc(role[0])}</label>`).join("");
        $("manageUserErr").textContent = ""; $("userModal").classList.add("show");
      }
      function closeManageUser() { $("userModal").classList.remove("show"); }
      async function saveManagedUser() {
        const selectedRoles = [...document.querySelectorAll("[data-managed-role]:checked")].map((input) => input.value);
        if (!selectedRoles.length) return ($("manageUserErr").textContent = "Select at least one role.");
        try {
          await api(`/api/v1/users/${$("manageUserId").value}`, { method: "PATCH", body: JSON.stringify({ roles: selectedRoles, status: $("manageUserStatus").value }) });
          closeManageUser(); await loadTeam();
        } catch (error) { $("manageUserErr").textContent = error.message; }
      }
      function esc(v) {
        return String(v ?? "").replace(
          /[&<>"']/g,
          (m) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[m],
        );
      }
      function date(v) {
        return v ? new Date(v).toLocaleString() : "—";
      }
      function formatSize(v) {
        v = Number(v || 0);
        if (v < 1024) return v + " B";
        if (v < 1048576) return (v / 1024).toFixed(1) + " KB";
        return (v / 1048576).toFixed(1) + " MB";
      }
      function fileContentType(file) {
        if (file.type) return file.type;
        const extension = String(file.name || "").split(".").pop().toLowerCase();
        return ({ pdf:"application/pdf", jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp", doc:"application/msword", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" })[extension] || "application/octet-stream";
      }
      async function fileChecksum(file) {
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      async function loadPortal() {
        try {
          const result = await api("/api/v1/portal");
          portalData = result.data;
          if(portalData.clients?.[0]?.preferred_language)setLanguage(portalData.clients[0].preferred_language);
          $("portalErr").textContent = "";
          renderPortal();
        } catch (error) {
          $("portalErr").textContent = error.message;
        }
      }
      function renderPortal() {
        const clientNumber=portalData.clients?.[0]?.client_number||"—";
        const client=portalData.clients?.[0]||{};
        $("portalCases").innerHTML = (portalData.cases || []).map((item) => `<div class="portal-card"><div class="eyebrow">${esc(item.case_number || item.case_reference || item.service_code || tr("case"))}</div><h3>${esc(item.case_type)}</h3><p>${esc(tr("clientNumber"))}: <b>${esc(clientNumber)}</b> · <span class="tag active">${esc(intakeOptionLabel(item.workflow_stage))}</span>${item.receipt_number ? ` · ${esc(tr("receiptNumber"))}: ${esc(item.receipt_number)}` : ""}</p><div class="df" style="justify-content:flex-start"><button class="btn" data-act="openPortalCase" data-a1="${item.id}">${esc(tr("open"))}</button>${item.service_code ? `<button class="btn primary" data-act="openIntake" data-a1="${item.id}" data-a2="${esc(item.service_code)}" data-a3="true">${esc(tr("intake"))}</button>` : ""}</div></div>`).join("") || `<div class="empty">${esc(tr("noRecords"))}</div>`;
        $("portalRequests").innerHTML = (portalData.document_requests || []).map((item) => `<div class="portal-card"><div><b>${esc(item.title)}</b><p class="muted">${esc(item.instructions || tr("uploadCorrectRequest"))}</p><span class="tag ${item.status === "approved" ? "active" : item.status === "rejected" ? "urgent" : "normal"}">${esc(intakeOptionLabel(item.status))}</span></div>${['missing','rejected'].includes(item.status) ? `<button class="btn primary" style="margin-top:12px" data-act="choosePortalFile" data-a1="${item.case_id}" data-a2="${item.id}">${esc(tr("uploadDocument"))}</button>` : ""}</div>`).join("") || `<div class="empty">${esc(tr("noRequestedDocuments"))}</div>`;
        $("portalDocuments").innerHTML=(portalData.documents||[]).map(item=>`<div class="portal-card"><b>${esc(item.file_name)}</b><p>${esc(intakeOptionLabel(item.review_status))} · ${formatSize(item.size_bytes)} · ${date(item.created_at)}</p><button class="btn" data-act="downloadPortalDocument" data-a1="${item.id}">${esc(tr("download"))}</button></div>`).join("")||`<div class="empty">${esc(tr("noDocuments"))}</div>`;
        $("portalAppointments").innerHTML = (portalData.appointments || []).map((item) => `<div class="portal-card"><b>${esc(item.title)}</b><p>${date(item.starts_at)}</p><small>${esc(item.location || tr("locationPending"))}</small></div>`).join("") || `<div class="empty">${esc(tr("noAppointments"))}</div>`;
        $("portalDeadlines").innerHTML=(portalData.deadlines||[]).map(item=>`<div class="portal-card"><b>${esc(item.title)}</b><p>${esc(item.deadline_date)} · ${esc(intakeOptionLabel(item.status))}</p><small>${esc(intakeOptionLabel(item.deadline_type))}</small></div>`).join("")||`<div class="empty">${esc(tr("noDeadlines"))}</div>`;
        $("portalNotifications").innerHTML=(portalData.notifications||[]).map(item=>`<div class="portal-card"><b>${esc(item.title)}</b><p><span class="tag ${item.severity==='critical'||item.severity==='high'?'urgent':'normal'}">${esc(intakeOptionLabel(item.severity))}</span>${item.due_at?` · ${date(item.due_at)}`:""}</p></div>`).join("")||`<div class="empty">${esc(tr("noNotifications"))}</div>`;
        $("portalBilling").innerHTML=(portalData.billing||[]).map(item=>{const amount=Number(item.office_fee_cents||0)+Number(item.government_fee_cents||0)+Number(item.other_fee_cents||0);return `<div class="portal-card"><b>${esc(item.invoice_number)}</b><p>${esc(tr("amount"))}: ${money(amount,item.currency)} · ${esc(intakeOptionLabel(item.status))}</p><small>${item.due_date?`${esc(tr("dueDate"))}: ${esc(item.due_date)}`:""}</small></div>`;}).join("")||`<div class="empty">${esc(tr("noBilling"))}</div>`;
        $("portalProfile").innerHTML=`<div class="sys"><div class="sysrow"><span>${esc(tr("clientNumber"))}</span><b>${esc(client.client_number||"—")}</b></div><div class="sysrow"><span>${esc(tr("displayName"))}</span><b>${esc(currentLanguage==="Arabic"&&client.legal_name_ar?client.legal_name_ar:client.legal_name||"—")}</b></div><div class="sysrow"><span>${esc(tr("email"))}</span><b>${esc(client.email||"—")}</b></div><div class="sysrow"><span>${esc(tr("phone"))}</span><b>${esc(client.phone||"—")}</b></div><div class="sysrow"><span>${esc(tr("preferredLanguage"))}</span><b>${esc(client.preferred_language||"—")}</b></div></div>`;
        applyTranslations();
      }
      async function openPortalCase(caseId) {
        try {
          const result = await api(`/api/v1/portal/cases/${caseId}`);
          const workspace = result.data;
          $("portalCaseModal").dataset.caseId = caseId;
          $("portalCaseTitle").textContent = workspace.case.case_type;
          const invoiceCards=(workspace.invoices||[]).map(item=>{const amount=Number(item.office_fee_cents||0)+Number(item.government_fee_cents||0)+Number(item.other_fee_cents||0);return `<div class="portal-card"><b>${esc(item.invoice_number)}</b><p>${money(amount,item.currency)} · ${esc(intakeOptionLabel(item.status))}</p></div>`;}).join("");
          $("portalCaseDetail").innerHTML = `<div class="sys"><div class="sysrow"><span>${esc(tr("caseNumber"))}</span><b>${esc(workspace.case.case_number || workspace.case.case_reference || tr("pending"))}</b></div><div class="sysrow"><span>${esc(tr("currentStatus"))}</span><b>${esc(intakeOptionLabel(workspace.case.workflow_stage))}</b></div><div class="sysrow"><span>${esc(tr("agency"))}</span><b>${esc(workspace.case.agency || tr("notAssigned"))}</b></div><div class="sysrow"><span>${esc(tr("receiptNumber"))}</span><b>${esc(workspace.case.receipt_number || tr("notReceived"))}</b></div></div><h3 style="margin-top:18px">${esc(tr("updates"))}</h3>${workspace.updates.map((item) => `<div class="portal-card"><p>${esc(item.body)}</p><small>${date(item.created_at)}</small></div>`).join("") || `<div class="empty">${esc(tr("noRecords"))}</div>`}<h3 style="margin-top:18px">${esc(tr("communications"))}</h3>${workspace.messages.map((item) => `<div class="portal-card"><b>${esc(intakeOptionLabel(item.sender_type))}</b><p>${esc(item.body)}</p><small>${date(item.created_at)}</small></div>`).join("") || `<div class="empty">${esc(tr("noRecords"))}</div>`}<h3 style="margin-top:18px">${esc(tr("approvedCommunications"))}</h3>${(workspace.approved_communications||[]).map(item=>`<div class="portal-card"><b>${esc(item.subject)}</b><p>${esc(item.body_text)}</p><small>${date(item.delivered_at||item.sent_at||item.created_at)}</small></div>`).join("")||`<div class="empty">${esc(tr("noRecords"))}</div>`}<h3 style="margin-top:18px">${esc(tr("deadlines"))}</h3>${(workspace.deadlines||[]).map(item=>`<div class="portal-card"><b>${esc(item.title)}</b><p>${esc(item.deadline_date)} · ${esc(intakeOptionLabel(item.status))}</p></div>`).join("")||`<div class="empty">${esc(tr("noDeadlines"))}</div>`}<h3 style="margin-top:18px">${esc(tr("authorizedBilling"))}</h3>${invoiceCards||`<div class="empty">${esc(tr("noBilling"))}</div>`}`;
          $("portalMessage").value = "";
          $("portalMessageErr").textContent = "";
          $("portalCaseModal").classList.add("show");
        } catch (error) {
          $("portalErr").textContent = error.message;
        }
      }
      function closePortalCase() {
        $("portalCaseModal").classList.remove("show");
      }
      async function sendPortalMessage() {
        const caseId = $("portalCaseModal").dataset.caseId;
        const body = $("portalMessage").value.trim();
        if (!body) return ($("portalMessageErr").textContent = tr("messageRequired"));
        try {
          await api(`/api/v1/portal/messages/${caseId}`, { method: "POST", body: JSON.stringify({ body }) });
          await openPortalCase(caseId);
        } catch (error) {
          $("portalMessageErr").textContent = error.message;
        }
      }
      async function downloadPortalDocument(id){
        try{const result=await api(`/api/v1/portal/documents/${id}/url`);window.open(result.data.url,"_blank","noopener,noreferrer");}
        catch(error){$("portalErr").textContent=error.message;}
      }
      function choosePortalFile(caseId, requestId) {
        portalUploadTarget = { caseId, requestId };
        $("portalFile").value = "";
        $("portalFile").click();
      }
      async function uploadPortalFile(file) {
        if (!portalUploadTarget || !file) return;
        const { caseId, requestId } = portalUploadTarget;
        $("portalErr").textContent = "Uploading securely…";
        try {
          const checksum = await fileChecksum(file);
          const contentType = fileContentType(file);
          const presigned = await api("/api/v1/portal/documents/presign", { method: "POST", body: JSON.stringify({ case_id: caseId, filename: file.name, content_type: contentType, size_bytes: file.size }) });
          const upload = await fetch(presigned.upload_url, { method: "PUT", headers: { "content-type": contentType }, body: file });
          if (!upload.ok) throw new Error("Upload failed");
          await api("/api/v1/portal/documents/confirm", { method: "POST", body: JSON.stringify({ case_id: caseId, request_id: requestId, key: presigned.key, file_name: file.name, content_type: contentType, size_bytes: file.size, content_checksum: checksum }) });
          portalUploadTarget = null;
          await loadPortal();
        } catch (error) {
          $("portalErr").textContent = error.message;
        }
      }
      function chooseImportFile(){ $("importFile").value="";$("importFile").click(); }
      async function uploadImportFile(file){if(!file)return;$("importErr").textContent="";$("importProgress").style.width="20%";try{const response=await fetch(`/api/v1/imports/upload?filename=${encodeURIComponent(file.name)}&size_bytes=${file.size}`,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/octet-stream"},body:file});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);$("importProgress").style.width="100%";selectedImportId=result.data.id;await loadImports();await openImport(result.data.id);}catch(error){$("importErr").textContent=error.message;$("importProgress").style.width="0";}}
      async function loadImports(){try{const result=await api("/api/v1/imports");$("importBatchTable").innerHTML=(result.data||[]).map(batch=>`<tr><td><b>${esc(batch.filename)}</b><small>${date(batch.created_at)}</small></td><td><span class="tag ${batch.status==='completed'?'active':batch.status==='failed'?'urgent':'normal'}">${esc(intakeOptionLabel(batch.status))}</span></td><td>${Number(batch.total_rows||0)}</td><td>${Number(batch.processed_rows||0)} / ${Number(batch.total_rows||0)}</td><td><button class="linkbtn" data-act="openImport" data-a1="${batch.id}">${esc(tr("open"))}</button></td></tr>`).join("")||`<tr><td colspan="5">${esc(tr("noRecords"))}</td></tr>`;$("importErr").textContent="";}catch(error){$("importErr").textContent=error.message;}}
      function renderImportReview(data){const {batch,rows}=data;selectedImportId=batch.id;$("importReviewPanel").style.display="block";$("importReviewTitle").textContent=`${tr("humanReview")} · ${batch.filename}`;const fields=["first_name","middle_name","last_name","legal_name","legal_name_ar","date_of_birth","gender","nationality","place_of_birth","passport_number","a_number","uscis_account_number","receipt_number","email","phone","whatsapp","physical_address","preferred_language","service_code","workflow_stage","assigned_user_id","priority","operational_notes"];$("importMapping").innerHTML=fields.map(field=>`<div class="field"><label>${esc(intakeOptionLabel(field))}</label><select data-import-map="${field}"><option value="">—</option>${(batch.headers||[]).map(header=>`<option value="${esc(header)}"${batch.field_mapping?.[field]===header?' selected':''}>${esc(header)}</option>`).join("")}</select></div>`).join("");const summary=batch.summary||{};$("importReviewSummary").textContent=`${summary.total||batch.total_rows||0} ${tr("rows")} · ${summary.valid||0} ${tr("valid")} · ${summary.invalid||0} ${tr("invalid")} · ${summary.new_clients||0} ${tr("new")} · ${summary.existing_clients||0} ${tr("existing")}`;$("importMetrics").innerHTML=[["total",summary.total||batch.total_rows],["valid",summary.valid],["invalid",summary.invalid],["possible",summary.possible_duplicates]].map(([label,value])=>`<div class="metric"><div class="k">${esc(tr(label))}</div><div class="v">${Number(value||0)}</div></div>`).join("");$("importRowTable").innerHTML=(rows||[]).slice(0,500).map(row=>{const n=row.normalized_row||{};const errors=row.validation_errors||[];return `<tr><td>${row.source_row_number}</td><td><b>${esc(n.legal_name||n.legal_name_ar||"—")}</b><small>${esc(n.email||n.phone||"")}</small></td><td>${esc(n.service_code||n.unmapped_service||"Client only")}</td><td><span class="tag ${row.duplicate_classification==='new'?'active':row.duplicate_classification==='possible'?'urgent':'normal'}">${esc(intakeOptionLabel(row.duplicate_classification))}</span></td><td>${errors.length?`<span class="err">${esc(errors.join(", "))}</span>`:`<span class="tag active">${esc(intakeOptionLabel(row.row_status))}</span>`}</td><td><button class="linkbtn" data-act="reviewImportRow" data-a1="${row.id}" data-a2="approve">${esc(tr("approve"))}</button> · <button class="linkbtn" data-act="reviewImportRow" data-a1="${row.id}" data-a2="skip">${esc(tr("skip"))}</button> · <button class="linkbtn" data-act="reviewImportRow" data-a1="${row.id}" data-a2="correct">${esc(tr("correct"))}</button> · <button class="linkbtn" data-act="reviewImportRow" data-a1="${row.id}" data-a2="staff">${esc(tr("assignStaff"))}</button>${n.unmapped_service?` · <button class="linkbtn" data-act="reviewImportRow" data-a1="${row.id}" data-a2="service">${esc(tr("mapService"))}</button>`:""}${row.duplicate_classification==='possible'?` · <button class="linkbtn" data-act="reviewImportRow" data-a1="${row.id}" data-a2="merge">${esc(tr("merge"))}</button>`:""}</td></tr>`;}).join("");if(batch.status==='processing'){clearTimeout(importPollTimer);importPollTimer=setTimeout(()=>openImport(batch.id),1500);}else clearTimeout(importPollTimer);}
      async function openImport(id){try{const result=await api(`/api/v1/imports/${id}`);renderImportReview(result.data);}catch(error){$("importErr").textContent=error.message;}}
      async function saveImportMapping(){if(!selectedImportId)return;const mapping=Object.fromEntries([...document.querySelectorAll('[data-import-map]')].filter(element=>element.value).map(element=>[element.dataset.importMap,element.value]));try{await api(`/api/v1/imports/${selectedImportId}/mapping`,{method:"PATCH",body:JSON.stringify({mapping})});await openImport(selectedImportId);}catch(error){$("importErr").textContent=error.message;}}
      async function runImportDryRun(){if(!selectedImportId)return;try{const result=await api(`/api/v1/imports/${selectedImportId}/dry-run`,{method:"POST",body:"{}"});if(result.data.canonical_writes!==0)throw new Error("DRY_RUN_WRITE_GUARD_FAILED");await openImport(selectedImportId);}catch(error){$("importErr").textContent=error.message;}}
      async function reviewImportRow(rowId,action){if(!selectedImportId)return;const body={action:['service','correct','staff'].includes(action)?'approve':action};if(action==='merge'){const clientId=prompt("Existing Client UUID");if(!clientId)return;body.merge_client_id=clientId;}if(action==='service'){const serviceCode=prompt("Existing service code (for example N-400)");if(!serviceCode)return;body.service_code=serviceCode;}if(action==='correct'){const header=prompt("Source column heading to correct");if(!header)return;const value=prompt("Corrected value");if(value===null)return;body.corrections={[header]:value};}if(action==='staff'){const userId=prompt("Assigned staff user UUID (leave blank to clear)");if(userId===null)return;body.assigned_user_id=userId;}try{await api(`/api/v1/imports/${selectedImportId}/rows/${rowId}`,{method:"PATCH",body:JSON.stringify(body)});await openImport(selectedImportId);}catch(error){$("importErr").textContent=error.message;}}
      async function approveImport(){if(!selectedImportId)return;try{await api(`/api/v1/imports/${selectedImportId}/approve`,{method:"POST",body:"{}"});await openImport(selectedImportId);}catch(error){$("importErr").textContent=error.message;}}
      async function processImport(){if(!selectedImportId)return;try{await api(`/api/v1/imports/${selectedImportId}/process`,{method:"POST",body:"{}"});await openImport(selectedImportId);}catch(error){$("importErr").textContent=error.message;}}
      function downloadImportReport(format='csv'){if(selectedImportId)window.location.assign(`/api/v1/imports/${selectedImportId}/report.${format==='xlsx'?'xlsx':'csv'}`);}
      async function boot() {
        renderRoles();
        configureNavigation();
        await Promise.all([testReady(), loadAlerts(), loadViewData("cases", true)]);
        const warmSecondaryData = () => Promise.allSettled([
          loadViewData("services"),
          loadViewData("clients"),
          loadViewData("documents"),
          loadViewData("tasks"),
        ]);
        if ("requestIdleCallback" in window) requestIdleCallback(warmSecondaryData, { timeout: 1800 });
        else setTimeout(warmSecondaryData, 250);
      }
      async function restoreSession() {
        renderRoles();
        try {
          const result = await api("/api/v1/auth/me");
          currentUser = result.user;
          setLanguage(currentUser.preferred_language);
          $("login").classList.add("hidden");
          const clientUser = currentUser.roles.some((role) => role === "client_owner" || role === "client_collaborator");
          if (clientUser) {
            $("staffApp").style.display = "none";
            $("clientPortal").classList.add("active");
            await loadPortal();
          } else await boot();
        } catch {
          $("login").classList.remove("hidden");
        }
      }
      $("password").addEventListener("keydown", (event) => {
        if (event.key === "Enter") signIn();
      });
      $("invitePasswordConfirm").addEventListener("keydown", (event) => {
        if (event.key === "Enter") acceptInvite();
      });
      $("portalFile").addEventListener("change", (event) => uploadPortalFile(event.target.files[0]));
      $("accessSubjectType").addEventListener("change", () => {
        $("accessSubject").innerHTML = optionList(accessSubjectOptions($("accessSubjectType").value));
        renderAccessForm();
      });
      $("accessSubject").addEventListener("change", renderAccessForm);
      $("accessRefresh").addEventListener("click", loadAccess);
      $("accessSave").addEventListener("click", saveAccessPolicy);
      $("accessClear").addEventListener("click", clearAccessPolicy);
      $("grantResourceType").addEventListener("change", renderGrantForm);
      $("grantAdd").addEventListener("click", applyRecordGrant);
      $("grantTable").addEventListener("click", async (event) => {
        const trigger = event.target.closest("[data-revoke]");
        if (!trigger) return;
        try {
          await api("/api/v1/access/record-grants/" + trigger.dataset.revoke, { method: "DELETE" });
          await loadAccess();
        } catch (e) {
          $("grantErr").textContent = e.detail || e.message;
        }
      });
      $("teamAdd").addEventListener("click", async () => {
        $("teamErr").textContent = "";
        try {
          await api("/api/v1/teams", { method: "POST", body: JSON.stringify({ name: $("teamName").value.trim() }) });
          $("teamName").value = "";
          await loadAccess();
        } catch (e) {
          $("teamErr").textContent = e.detail || e.message;
        }
      });
      $("teamMemberAdd").addEventListener("click", async () => {
        $("teamErr").textContent = "";
        try {
          await api(`/api/v1/teams/${$("teamMemberTeam").value}/members`, { method: "POST", body: JSON.stringify({ user_id: $("teamMemberUser").value }) });
          await loadAccess();
        } catch (e) {
          $("teamErr").textContent = e.detail || e.message;
        }
      });

      // ---- UI action dispatch ------------------------------------------------
      //
      // The page carries no inline event handlers, so the Content-Security-Policy
      // can refuse inline script outright. Markup declares an intent
      // (data-act="openCase" data-a1="...") and this table is the only thing that
      // turns that name into a call: an unknown or attacker-supplied name matches
      // nothing and does nothing. No eval, no lookup by string on window.
      const uiActions = Object.freeze({
        acceptInvite,
        addIntakePerson,
        chooseIdentityFile,
        chooseOfficeLogo,
        choosePortalFile,
        chooseDocumentFile,
        clearDocumentFile,
        closeCase,
        closeCaseWorkspace,
        closeClient,
        closeInvoice,
        closeManageUser,
        closePortalCase,
        closeTask,
        confirmIdentityAutofill,
        deleteDoc,
        downloadDoc,
        downloadPortalDocument,
        editCase,
        editClient,
        editIntakeStep: a => editIntakeStep(Number(a)),
        editTask,
        inviteUser,
        loadAudit,
        loadCases,
        loadDocuments,
        loadPortal,
        loadImports,
        loadReports,
        loadReviewQueue,
        loadSettings,
        loadTasks,
        nextIntakeStep,
        openCase,
        openCaseEditor,
        openClient,
        openIntake: (a, b, c) => openIntake(a, b, c === "true"),
        openInvoice,
        openImport,
        openManageUser,
        openPortalCase,
        openSearchClient,
        openTask,
        previewDoc,
        previousIntakeStep,
        refreshAlerts,
        removeIntakePerson: (a, b) => removeIntakePerson(a, Number(b)),
        renderCaseTable,
        renderClients,
        renderServices,
        reviewDocument,
        reviewImportRow,
        runImportDryRun,
        approveImport,
        processImport,
        downloadImportReport,
        chooseImportFile,
        saveAndExitIntake,
        saveCase,
        saveClient,
        saveInvoice,
        saveImportMapping,
        saveManagedUser,
        saveOfficeSettings,
        saveProfileSettings,
        saveTask,
        sendPortalMessage,
        showView,
        signIn,
        signOut,
        switchLanguage: (a,b,c,element) => switchLanguage(element.value),
        switchWorkspaceTab,
        testReady,
        uploadDocument,
        unifiedSearch,
      });

      function runUiAction(element) {
        const handler = uiActions[element.dataset.act];
        if (!handler) return;
        handler(element.dataset.a1, element.dataset.a2, element.dataset.a3, element);
      }

      document.addEventListener("click", (event) => {
        const element = event.target.closest("[data-act]");
        // Elements wired to change/input must not also fire on click.
        if (!element || (element.dataset.on && element.dataset.on !== "click")) return;
        runUiAction(element);
      });
      document.addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        const element = event.target.closest('[role="button"][data-act]');
        if (!element) return;
        event.preventDefault();
        runUiAction(element);
      });
      $("docFile").addEventListener("change", (event) => setDocumentFile(event.target.files[0]));
      $("identityFile").addEventListener("change", (event) => runIdentityOcr(event.target.files[0]));
      $("officeLogoFile").addEventListener("change", (event) => uploadOfficeLogo(event.target.files[0]));
      $("importFile").addEventListener("change", (event) => uploadImportFile(event.target.files[0]));
      for (const type of ["dragenter", "dragover"]) $("docDropzone").addEventListener(type, (event) => { event.preventDefault(); $("docDropzone").classList.add("dragging"); });
      for (const type of ["dragleave", "drop"]) $("docDropzone").addEventListener(type, (event) => { event.preventDefault(); $("docDropzone").classList.remove("dragging"); });
      $("docDropzone").addEventListener("drop", (event) => setDocumentFile(event.dataTransfer.files[0]));
      for (const type of ["dragenter", "dragover"]) $("importDropzone").addEventListener(type, (event) => { event.preventDefault(); $("importDropzone").classList.add("dragging"); });
      for (const type of ["dragleave", "drop"]) $("importDropzone").addEventListener(type, (event) => { event.preventDefault(); $("importDropzone").classList.remove("dragging"); });
      $("importDropzone").addEventListener("drop", (event) => uploadImportFile(event.dataTransfer.files[0]));
      let inputActionTimer = null;
      for (const type of ["change", "input"]) {
        document.addEventListener(type, (event) => {
          const element = event.target.closest(`[data-act][data-on="${type}"]`);
          if (!element) return;
          if (type === "input") {
            clearTimeout(inputActionTimer);
            inputActionTimer = setTimeout(() => runUiAction(element), 140);
          } else runUiAction(element);
        });
      }

      if (!prepareInvitation()) restoreSession();
