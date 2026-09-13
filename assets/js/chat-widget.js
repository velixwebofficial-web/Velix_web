/* ==========================================================================
   VELIX WEB SOLUTIONS — LIVE CHAT WIDGET (AI Architecture v2)
   A floating chat assistant that greets visitors, talks to a real Claude
   model through the /api/chat AI gateway (see /api/chat.js and /lib/*),
   and — when appropriate — collects lead details or generates a real,
   computed quote, pushing both straight into the Admin Dashboard.

   NOTE ON HONESTY: this widget now calls a real backend (/api/chat) that
   holds the Anthropic API key server-side and streams Claude's reply back.
   If that backend is unreachable (not deployed yet, ANTHROPIC_API_KEY
   missing, offline visitor, etc.) it falls back to the original local
   FAQ keyword-matching engine below (match()) rather than breaking the
   chat outright — a visitor should never see a dead widget.
   ========================================================================== */

(function () {
  const CONTACT = {
    phone: '+962 79 969 1748',
    phoneHref: '+962799691748',
    email: 'velixweb.official@gmail.com',
    facebook: 'https://www.facebook.com/profile.php?id=61591738294523',
    instagram: 'https://www.instagram.com/velixweb26/'
  };

  function getLang() {
    return (window.VELIX_I18N && window.VELIX_I18N.getLang) ? window.VELIX_I18N.getLang() : 'en';
  }

  // Each FAQ entry is matched against a shared, bilingual keyword list, then
  // answered back in whichever language the interface is currently set to.
  const FAQ = [
    {
      keys: ['price', 'cost', 'how much', 'pricing', 'budget', 'quote', 'سعر', 'اسعار', 'تكلفة', 'فلوس'],
      en: "We recently lowered our prices while adding even more value to every package:<br><br>• <strong>Starter</strong> (up to 5 pages): <strong>99 JOD</strong><br>• <strong>Business</strong> (up to 10 pages, Premium design, SEO): <strong>199 JOD</strong><br>• <strong>Professional</strong> (unlimited pages, fully custom design, animations): <strong>349 JOD</strong><br>• <strong>E-commerce store</strong> (products, cart, dashboard, order management): starting at <strong>499 JOD</strong><br><br>Every package now includes a <strong>free live design session</strong> where you watch us build your design in real time and ask for changes on the spot, up to <strong>3 working meetings</strong> (max 2 hours each) during the project, and an official <strong>completion certificate</strong> at the end. Want me to put together an exact quote for your project?",
      ar: "خفّضنا أسعارنا مؤخرًا مع إضافة قيمة أكبر لكل باقة:<br><br>• <strong>Starter</strong> (حتى 5 صفحات): <strong>99 دينار</strong><br>• <strong>Business</strong> (حتى 10 صفحات، تصميم Premium، SEO): <strong>199 دينار</strong><br>• <strong>Professional</strong> (صفحات غير محدودة، تصميم مخصص بالكامل، Animations): <strong>349 دينار</strong><br>• <strong>متجر إلكتروني</strong> (منتجات، سلة، لوحة تحكم، إدارة طلبات): يبدأ من <strong>499 دينار</strong><br><br>كل باقة الآن تشمل <strong>جلسة تصميم مجانية مباشرة</strong> نبني فيها التصميم أمامك وتطلب التعديلات فورًا، بالإضافة إلى <strong>3 اجتماعات عمل</strong> خلال المشروع (بحد أقصى ساعتين لكل اجتماع)، و<strong>شهادة إتمام مشروع</strong> رسمية في النهاية. هل تريدني أن أجهز لك عرض سعر دقيق لمشروعك؟"
    },
    {
      keys: ['how long', 'timeline', 'duration', 'delivery time', 'how many days', 'how many weeks', 'مدة', 'وقت التسليم', 'كم يوم', 'كم اسبوع'],
      en: "Most landing pages take <strong>1–2 weeks</strong>, business websites <strong>2–4 weeks</strong>, and larger platforms with dashboards or e-commerce <strong>4–8 weeks</strong> — depending on content readiness and revisions. I can give you a firm timeline once I know a bit more about your project.",
      ar: "معظم صفحات الهبوط تستغرق <strong>1-2 أسبوع</strong>، مواقع الشركات <strong>2-4 أسابيع</strong>، والمنصات الأكبر مع لوحات التحكم أو المتاجر الإلكترونية <strong>4-8 أسابيع</strong> — حسب جاهزية المحتوى والتعديلات. يمكنني إعطاؤك جدولًا زمنيًا دقيقًا بعد معرفة المزيد عن مشروعك."
    },
    {
      keys: ['service', 'what do you do', 'what do you offer', 'offer', 'خدمات', 'شو بتقدموا', 'شغلكم'],
      en: "VELIX builds premium, high-performance websites end-to-end: web design, front-end &amp; back-end development, e-commerce, landing pages, corporate websites, SEO, security hardening and ongoing maintenance. Basically — everything your business needs to go online and actually convert visitors into customers.",
      ar: "تبني فيليكس مواقع متميزة وعالية الأداء من الألف إلى الياء: تصميم المواقع، تطوير الواجهات الأمامية والخلفية، المتاجر الإلكترونية، صفحات الهبوط، مواقع الشركات، تحسين محركات البحث، تعزيز الأمان والصيانة المستمرة. باختصار — كل ما يحتاجه عملك للانتقال إلى الإنترنت وتحويل الزوار فعليًا إلى عملاء."
    },
    {
      keys: ['technology', 'tech stack', 'stack', 'framework', 'built with', 'تقنيات'],
      en: "We choose the right stack for the job rather than forcing one tool everywhere — typically modern HTML5/CSS3/JavaScript on the front end, and React, Node.js or Shopify/WordPress on the back end depending on your needs, with a strong focus on speed and security.",
      ar: "نختار التقنية المناسبة لكل مشروع بدلًا من فرض أداة واحدة على الجميع — عادةً HTML5/CSS3/JavaScript حديثة في الواجهة الأمامية، وReact أو Node.js أو Shopify/WordPress في الخلفية حسب احتياجاتك، مع تركيز قوي على السرعة والأمان."
    },
    {
      keys: ['support', 'maintenance', 'after launch', 'update my site', 'صيانة', 'دعم'],
      en: "Every project comes with a post-launch support window, and we offer ongoing maintenance plans after that — covering updates, backups, security monitoring and small content changes, so your site stays fast and safe long after launch.",
      ar: "كل مشروع يأتي مع فترة دعم بعد الإطلاق، ونقدم خطط صيانة مستمرة بعد ذلك — تشمل التحديثات والنسخ الاحتياطية ومراقبة الأمان والتعديلات الصغيرة على المحتوى، ليبقى موقعك سريعًا وآمنًا لفترة طويلة بعد الإطلاق."
    },
    {
      keys: ['hosting', 'domain', 'server', 'استضافة', 'دومين'],
      en: "Yes — we can handle hosting and domain setup for you end-to-end, or work with hosting you already have. We'll always recommend the option that's fastest and most reliable for your specific site.",
      ar: "نعم — يمكننا إدارة الاستضافة وإعداد الدومين لك بالكامل، أو العمل مع الاستضافة الحالية لديك. سنوصي دائمًا بالخيار الأسرع والأكثر موثوقية لموقعك تحديدًا."
    },
    {
      keys: ['seo', 'google ranking', 'search engine', 'ظهور بجوجل', 'محركات البحث'],
      en: "Every VELIX website ships with SEO fundamentals built in: clean structured markup, fast load times, meta tags, sitemaps and mobile optimization. We also offer deeper ongoing SEO campaigns if you want to actively grow search traffic over time.",
      ar: "كل موقع من فيليكس يأتي مزودًا بأساسيات تحسين محركات البحث: أكواد نظيفة ومنظمة، أوقات تحميل سريعة، وسوم ميتا، خرائط مواقع وتحسين للجوال. نقدم أيضًا حملات SEO أعمق ومستمرة إذا أردت زيادة زوار البحث بمرور الوقت."
    },
    {
      keys: ['security', 'secure', 'hack', 'protection', 'حماية', 'امان'],
      en: "Security is standard on every build — HTTPS, hardened forms, regular dependency updates and monitoring. For e-commerce or platforms handling sensitive data we add extra layers like rate-limiting, authentication best practices and regular audits.",
      ar: "الأمان معيار أساسي في كل بناء — HTTPS، نماذج محصّنة، تحديثات ومراقبة دورية. أما للمتاجر الإلكترونية أو المنصات التي تتعامل مع بيانات حساسة، نضيف طبقات إضافية مثل تحديد معدل الطلبات، أفضل ممارسات المصادقة والمراجعات الدورية."
    },
    {
      keys: ['contact', 'phone', 'number', 'call', 'رقم', 'تواصل', 'اتصال'],
      en: `You can reach the team directly at <strong>${CONTACT.phone}</strong> or by email at <strong>${CONTACT.email}</strong>. Or — even easier — tell me a bit about your project right here and I'll make sure the right person follows up with you.`,
      ar: `يمكنك التواصل مع الفريق مباشرة على <strong>${CONTACT.phone}</strong> أو عبر البريد الإلكتروني <strong>${CONTACT.email}</strong>. أو — بشكل أسهل — أخبرني قليلًا عن مشروعك هنا وسأتأكد من أن الشخص المناسب سيتابع معك.`
    },
    {
      keys: ['email', 'mail', 'ايميل', 'بريد'],
      en: `Our email is <strong>${CONTACT.email}</strong>. I'm also happy to pass your details straight to the team if you'd rather I set that up for you right now.`,
      ar: `بريدنا الإلكتروني هو <strong>${CONTACT.email}</strong>. يسعدني أيضًا تمرير بياناتك مباشرة إلى الفريق إذا أردت أن أرتب ذلك لك الآن.`
    },
    {
      keys: ['process', 'how does it work', 'steps', 'كيف بتشتغلوا', 'خطوات'],
      en: "Our process is simple: <strong>1)</strong> Understanding your requirements &amp; goals, <strong>2)</strong> Agreeing on project scope and price, <strong>3)</strong> A <strong>free live design session</strong> where we build your design in front of you and adjust it on the spot until you love it, <strong>4)</strong> Development, <strong>5)</strong> Review meetings (up to 3, max 2 hours each) to fine-tune agreed changes, <strong>6)</strong> Final delivery with your <strong>completion certificate</strong>, <strong>7)</strong> Ongoing support. You'll see progress at every stage before anything goes live.",
      ar: "عمليتنا بسيطة: <strong>1)</strong> فهم متطلبات وأهداف مشروعك، <strong>2)</strong> الاتفاق على نطاق المشروع والسعر، <strong>3)</strong> <strong>جلسة تصميم مجانية مباشرة</strong> نبني فيها التصميم أمامك ونعدّله فورًا حتى يعجبك، <strong>4)</strong> التنفيذ والتطوير، <strong>5)</strong> اجتماعات مراجعة (حتى 3 اجتماعات، بحد أقصى ساعتين لكل اجتماع) لتنفيذ التعديلات المتفق عليها، <strong>6)</strong> التسليم النهائي مع <strong>شهادة إتمام المشروع</strong>، <strong>7)</strong> الدعم المستمر بعد ذلك. سترى التقدم في كل مرحلة قبل أن يُطلق أي شيء."
    },
    {
      keys: ['meeting', 'meetings', 'how many meetings', 'ميتنج', 'ميتنجات', 'اجتماع', 'اجتماعات'],
      en: "Every design &amp; development project (websites, stores, landing pages, etc.) includes: one <strong>free design meeting</strong> with no time limit on rounds — we build the design live and revise it together until you're happy — plus up to <strong>3 working meetings</strong> during the rest of the project, each capped at <strong>2 hours</strong>, to review progress and confirm changes. Once you approve the final result, you get a full <strong>completion certificate</strong>. Note: this meeting structure is for design/development — the security &amp; protection plan below works differently, with a separate free consultation and monthly check-ins.",
      ar: "كل مشروع تصميم وتطوير (مواقع، متاجر، صفحات هبوط... إلخ) يشمل: <strong>اجتماع تصميم مجاني</strong> بدون حد لعدد جولات التعديل — نبني التصميم أمامك ونعدّله سويًا لحد ما يعجبك — بالإضافة إلى <strong>3 اجتماعات عمل</strong> خلال باقي المشروع، بحد أقصى <strong>ساعتين</strong> لكل اجتماع، لمراجعة التقدم وتأكيد التعديلات. بعد موافقتك على النتيجة النهائية بتاخذ <strong>شهادة إتمام مشروع</strong> كاملة. ملاحظة: هذا الهيكل خاص بخدمات التصميم والتطوير — أما خطة الحماية أدناه فتعمل بشكل مختلف، باستشارة مجانية منفصلة ومتابعة شهرية."
    },
    {
      keys: ['protection plan', 'year of support', 'monthly report', 'security plan', 'ongoing protection', 'خطة الحماية', 'حماية سنوية', 'استشارة', 'تقرير شهري', 'متابعة سنوية'],
      en: "Beyond the build itself, we offer a full year of <strong>website protection &amp; consultation</strong>: it starts with a <strong>free consultation meeting</strong> to review your site's security, then every month for a full year our team runs a check-up and sends you a <strong>complete monthly report</strong> — covering vulnerabilities, backups, uptime and performance. This is separate from the design meetings above and can be added on top of any website or store package.",
      ar: "بالإضافة إلى بناء الموقع، نقدم <strong>حماية واستشارة لمدة سنة كاملة</strong>: تبدأ باجتماع <strong>استشارة مجاني</strong> لمراجعة أمان موقعك، وبعدها كل شهر لمدة سنة كاملة يقوم فريقنا بفحص شامل ويرسل لك <strong>تقريرًا كاملًا كل شهر</strong> — يغطي الثغرات، النسخ الاحتياطية، جاهزية الموقع والأداء. هذه الخدمة منفصلة عن اجتماعات التصميم أعلاه ويمكن إضافتها فوق أي باقة موقع أو متجر."
    },
    {
      keys: ['certificate', 'guarantee', 'warranty', 'شهادة', 'ضمان'],
      en: "Yes — every completed project comes with an official <strong>project completion certificate</strong> once you've approved the final result, confirming the scope delivered and the support window that follows. It's part of every package, no extra charge.",
      ar: "نعم — كل مشروع مكتمل يحصل على <strong>شهادة إتمام مشروع</strong> رسمية بعد موافقتك على النتيجة النهائية، تؤكد نطاق العمل المُسلَّم وفترة الدعم التي تليه. وهي جزء من كل باقة بدون أي تكلفة إضافية."
    },
    {
      keys: ['competitor', 'competitors', 'other agencies', 'other companies', 'why velix', 'why you', 'منافس', 'منافسين', 'شركات ثانية', 'ليش فيليكس', 'ليش نختاركم'],
      en: "There's no shortage of web agencies in the region, but a few things set VELIX apart: <strong>1)</strong> you watch your design get built live in a free session and request changes on the spot, instead of waiting days between revisions, <strong>2)</strong> a full year of security monitoring with a real monthly report — most agencies stop at delivery, <strong>3)</strong> an official completion certificate for every project, and <strong>4)</strong> direct, personal review of your project by our founder before anything ships. Happy to walk through how that compares to a specific agency you're considering.",
      ar: "لا يوجد نقص في وكالات الويب في المنطقة، لكن بعض الأشياء تميّز فيليكس: <strong>1)</strong> تشاهد تصميمك يُبنى مباشرة أمامك في جلسة مجانية وتطلب التعديلات فورًا، بدل انتظار أيام بين كل تعديل، <strong>2)</strong> سنة كاملة من مراقبة الأمان مع تقرير شهري حقيقي — معظم الشركات تتوقف عند التسليم، <strong>3)</strong> شهادة إتمام رسمية لكل مشروع، <strong>4)</strong> مراجعة شخصية ومباشرة من مؤسسنا لكل مشروع قبل تسليمه. يسعدني أن أوضح لك كيف تقارن مع شركة معينة تفكر فيها."
    },
    {
      keys: ['follow', 'facebook', 'instagram', 'social media', 'فيسبوك', 'انستا', 'انستقرام', 'تابعوا', 'متابعة'],
      en: `We'd love to have you with us! Give VELIX a follow on <a href="${CONTACT.facebook}" target="_blank" rel="noopener noreferrer">Facebook</a> and <a href="${CONTACT.instagram}" target="_blank" rel="noopener noreferrer">Instagram</a> — that's where we post new projects, tips, and behind-the-scenes work, and it genuinely helps a small studio like ours grow. Thank you for the support!`,
      ar: `يسعدنا انضمامك لنا! تابع فيليكس على <a href="${CONTACT.facebook}" target="_blank" rel="noopener noreferrer">فيسبوك</a> و<a href="${CONTACT.instagram}" target="_blank" rel="noopener noreferrer">انستغرام</a> — هناك ننشر مشاريعنا الجديدة ونصائحنا وكواليس عملنا، ومتابعتك تساعد استوديو صغير مثلنا على النمو فعليًا. شكرًا لدعمك!`
    },
    {
      keys: ['portfolio', 'examples', 'work', 'previous projects', 'اعمال سابقة', 'نماذج'],
      en: 'You can see selected projects on our <a href="portfolio.html">Portfolio page</a> — happy to walk you through which of them is closest to what you have in mind.',
      ar: 'يمكنك مشاهدة مشاريع مختارة في صفحة <a href="portfolio.html">أعمالنا</a> — يسعدني أن أوضح لك أيها الأقرب لما تفكر فيه.'
    },
    {
      keys: ['who are you', 'company', 'about velix', 'مين انتوا', 'الشركة'],
      en: 'VELIX Web Solutions is a premium web design &amp; development studio led by <strong>Moatasm Abdeen</strong> (Founder &amp; CEO), who personally reviews every project before delivery, alongside a dedicated Backend Developer. We keep the team lean so every client gets real, senior attention.',
      ar: 'فيليكس لحلول الويب هو استوديو متميز لتصميم وتطوير المواقع يقوده <strong>Moatasm Abdeen</strong> (المؤسس والرئيس التنفيذي)، الذي يراجع شخصيًا كل مشروع قبل التسليم، إلى جانب مطوّر خلفية متخصص. نبقي الفريق صغيرًا ليحصل كل عميل على اهتمام حقيقي من كبار المختصين.'
    }
  ];

  const STR = {
    en: {
      toggleOpen: 'Open live chat',
      assistantName: 'VELIX Assistant',
      assistantStatus: 'Typically replies instantly',
      dialogLabel: 'VELIX live chat',
      closeLabel: 'Close chat',
      inputPlaceholder: 'Type your question…',
      sendLabel: 'Send',
      greeting: "Welcome to VELIX Web Solutions. I'd be happy to help you choose the best solution for your business — you can ask me about pricing, timelines, our process, or anything else about working with us.",
      quickReplies: ['Pricing', 'How meetings work', 'Protection plan', 'Talk to a human'],
      humanHandoff: `Of course — you can call us directly at <strong>${CONTACT.phone}</strong> or email <strong>${CONTACT.email}</strong>. Or share your details below and our team will call you.`,
      fallback: "Great question — let me make sure our team gives you an exact answer for your specific project. Mind sharing a few details so the right person can follow up?",
      leadIntro: "I want to make sure the right specialist follows up personally — mind sharing a few details?",
      leadName: 'Your name',
      leadPhone: 'Phone number',
      leadEmail: 'Email (optional)',
      leadCompany: 'Company (optional)',
      leadDetails: 'Tell us briefly about your project',
      leadBudget: 'Estimated budget (optional)',
      leadTimeline: 'Desired timeline (optional)',
      leadSubmit: 'Send to VELIX Team',
      leadThanks: (name) => `Thank you, ${name} — you're all set. A member of the VELIX team will reach out shortly. Anything else I can help with in the meantime? (And if you have a moment, a follow on our <a href="${CONTACT.facebook}" target="_blank" rel="noopener noreferrer">Facebook</a> or <a href="${CONTACT.instagram}" target="_blank" rel="noopener noreferrer">Instagram</a> would mean a lot!)`,
      quoteTitle: 'Your Quote',
      quoteRef: 'Reference',
      quoteTotal: 'Total',
      quotePriceOnRequest: 'Some items are priced on request — the team will confirm exact figures.',
      leadSavedNote: 'Saved — the VELIX team can see this in their dashboard.'
    },
    ar: {
      toggleOpen: 'فتح المحادثة المباشرة',
      assistantName: 'مساعد فيليكس',
      assistantStatus: 'يرد عادة على الفور',
      dialogLabel: 'محادثة فيليكس المباشرة',
      closeLabel: 'إغلاق المحادثة',
      inputPlaceholder: 'اكتب سؤالك…',
      sendLabel: 'إرسال',
      greeting: 'مرحبًا بك في فيليكس لحلول الويب. يسعدني مساعدتك في اختيار الحل الأنسب لعملك — يمكنك سؤالي عن الأسعار، الجدول الزمني، طريقة عملنا، أو أي شيء آخر عن العمل معنا.',
      quickReplies: ['الأسعار', 'آلية الاجتماعات', 'خطة الحماية', 'التحدث مع شخص'],
      humanHandoff: `بالتأكيد — يمكنك الاتصال بنا مباشرة على <strong>${CONTACT.phone}</strong> أو عبر البريد الإلكتروني <strong>${CONTACT.email}</strong>. أو شارك بياناتك أدناه وسيتصل بك فريقنا.`,
      fallback: 'سؤال ممتاز — دعني أتأكد من أن فريقنا يعطيك إجابة دقيقة لمشروعك الخاص. هل تمانع مشاركة بعض التفاصيل ليتابع معك الشخص المناسب؟',
      leadIntro: 'أريد التأكد من أن المختص المناسب سيتابع معك شخصيًا — هل تمانع مشاركة بعض التفاصيل؟',
      leadName: 'اسمك',
      leadPhone: 'رقم الهاتف',
      leadEmail: 'البريد الإلكتروني (اختياري)',
      leadCompany: 'الشركة (اختياري)',
      leadDetails: 'أخبرنا باختصار عن مشروعك',
      leadBudget: 'الميزانية التقديرية (اختياري)',
      leadTimeline: 'الجدول الزمني المطلوب (اختياري)',
      leadSubmit: 'إرسال إلى فريق فيليكس',
      leadThanks: (name) => `شكرًا لك، ${name} — كل شيء جاهز. سيتواصل معك أحد أعضاء فريق فيليكس قريبًا. هل هناك أي شيء آخر يمكنني مساعدتك به في هذه الأثناء؟ (وإذا سمح وقتك، متابعتنا على <a href="${CONTACT.facebook}" target="_blank" rel="noopener noreferrer">فيسبوك</a> أو <a href="${CONTACT.instagram}" target="_blank" rel="noopener noreferrer">انستغرام</a> بتعني الكثير لنا!)`,
      quoteTitle: 'عرض السعر الخاص بك',
      quoteRef: 'الرقم المرجعي',
      quoteTotal: 'الإجمالي',
      quotePriceOnRequest: 'بعض العناصر سعرها عند الطلب — سيؤكد الفريق الأرقام الدقيقة.',
      leadSavedNote: 'تم الحفظ — يمكن لفريق فيليكس رؤية هذا في لوحة التحكم.'
    }
  };

  function s(key) {
    const table = STR[getLang()] || STR.en;
    return table[key] !== undefined ? table[key] : STR.en[key];
  }

  function match(text) {
    const lower = text.toLowerCase();
    const lang = getLang();
    for (const item of FAQ) {
      if (item.keys.some(k => lower.includes(k))) return lang === 'ar' ? item.ar : item.en;
    }
    return null;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function buildWidget() {
    const wrap = document.createElement('div');
    wrap.className = 'velix-chat';
    wrap.innerHTML = `
      <button class="velix-chat-toggle" aria-label="${s('toggleOpen')}">
        <svg class="ic-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        <svg class="ic-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        <span class="velix-chat-dot"></span>
      </button>
      <div class="velix-chat-panel" role="dialog" aria-modal="true" aria-label="${s('dialogLabel')}">
        <div class="velix-chat-head">
          <div class="velix-chat-avatar">V</div>
          <div class="velix-chat-head-info">
            <strong class="velix-chat-name">${s('assistantName')}</strong>
            <span class="velix-chat-status">${s('assistantStatus')}</span>
          </div>
          <button type="button" class="velix-chat-close-mobile" aria-label="${s('closeLabel')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="velix-chat-body" id="velixChatBody"></div>
        <div class="velix-chat-quick" id="velixQuickReplies"></div>
        <form class="velix-chat-input" id="velixChatForm">
          <input type="text" id="velixChatInput" placeholder="${s('inputPlaceholder')}" autocomplete="off" aria-label="${s('inputPlaceholder')}">
          <button type="submit" aria-label="${s('sendLabel')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          </button>
        </form>
      </div>`;
    document.body.appendChild(wrap);
    return wrap;
  }

  function scrollToBottom(body) {
    body.scrollTop = body.scrollHeight;
  }

  function addBubble(body, text, who) {
    const bubble = document.createElement('div');
    bubble.className = 'velix-bubble ' + (who === 'user' ? 'is-user' : 'is-bot');
    bubble.innerHTML = text;
    body.appendChild(bubble);
    scrollToBottom(body);
    return bubble;
  }

  function addTyping(body) {
    const row = document.createElement('div');
    row.className = 'velix-typing-row';
    row.innerHTML = '<span class="velix-typing-avatar">V</span><span class="velix-bubble is-bot is-typing"><span></span><span></span><span></span></span>';
    body.appendChild(row);
    scrollToBottom(body);
    return row;
  }

  // Quote generator (§19): renders the pricing engine's structured output
  // as a formatted card in the chat — a real artifact, not just a prose
  // sentence, per architecture §19's "returns a structured price
  // breakdown, not prose" requirement.
  function quoteCard(quote) {
    const rows = [
      `<div class="velix-quote-row"><span>${escapeHtml(quote.package.name)}</span><span>${quote.package.price} ${quote.currency}</span></div>`
    ].concat((quote.addons || []).map(a =>
      `<div class="velix-quote-row"><span>${escapeHtml(a.name)}</span><span>${a.price === null ? '—' : a.price + ' ' + quote.currency}</span></div>`
    ));
    return `<div class="velix-quote-card">
      <strong>${s('quoteTitle')}</strong>
      <div class="velix-quote-ref">${s('quoteRef')}: ${escapeHtml(quote.referenceNumber)}</div>
      ${rows.join('')}
      <div class="velix-quote-row velix-quote-total"><span>${s('quoteTotal')}</span><span>${quote.total} ${quote.currency}</span></div>
      ${quote.hasPriceOnRequestItems ? `<div class="velix-quote-note">${s('quotePriceOnRequest')}</div>` : ''}
    </div>`;
  }

  function leadForm() {
    return `<div class="velix-lead-card">
      <p>${s('leadIntro')}</p>
      <form id="velixLeadForm" class="velix-lead-form">
        <input required name="name" placeholder="${s('leadName')}">
        <input required name="phone" placeholder="${s('leadPhone')}" type="tel">
        <input name="email" placeholder="${s('leadEmail')}" type="email">
        <input name="company" placeholder="${s('leadCompany')}">
        <textarea name="projectDetails" placeholder="${s('leadDetails')}" rows="2"></textarea>
        <input name="budget" placeholder="${s('leadBudget')}">
        <input name="timeline" placeholder="${s('leadTimeline')}">
        <button type="submit" class="btn btn-accent">${s('leadSubmit')}</button>
      </form>
    </div>`;
  }

  function init() {
    if (!window.VELIX) return; // store.js must load first
    const widget = buildWidget();
    const toggle = widget.querySelector('.velix-chat-toggle');
    const panel = widget.querySelector('.velix-chat-panel');
    const body = widget.querySelector('#velixChatBody');
    const form = widget.querySelector('#velixChatForm');
    const input = widget.querySelector('#velixChatInput');
    const quickWrap = widget.querySelector('#velixQuickReplies');

    const closeMobileBtn = widget.querySelector('.velix-chat-close-mobile');
    const conversationId = VELIX.uid('conv');
    const transcript = [];

    // Short-term memory (§7 MVP: held client-side and sent with every
    // request rather than server-persisted, since there's no returning-
    // visitor volume yet to justify server-side long-term memory) and the
    // conversation manager's current state (§5) — starts at Discovery.
    let aiHistory = [];
    let conversationState = 'discovery';
    let aiUnavailable = false; // flips true after a failed call, so we stop retrying a dead backend all conversation long

    function closePanel() {
      panel.classList.remove('is-open');
      toggle.classList.remove('is-open');
    }

    function record(text, who) {
      transcript.push({ text, who, at: new Date().toISOString() });
      VELIX.conversations.save({ id: conversationId, messages: transcript });
    }

    function renderQuickReplies() {
      const replies = s('quickReplies');
      quickWrap.innerHTML = replies.map(q => `<button type="button" class="velix-quick-btn">${q}</button>`).join('');
      quickWrap.querySelectorAll('.velix-quick-btn').forEach(btn => {
        btn.addEventListener('click', () => handleUserMessage(btn.textContent));
      });
    }

    function showLeadForm() {
      const bubble = addBubble(body, leadForm(), 'bot');
      bubble.querySelector('#velixLeadForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target).entries());
        VELIX.leads.create(Object.assign({}, data, { source: 'Live Chat', conversationId }));
        record('[Lead submitted: ' + data.name + ']', 'user');
        bubble.innerHTML = '<p>' + s('leadThanks')(escapeHtml(data.name)) + '</p>';
      });
    }

    // Fallback path: the original local keyword-matching engine. Used only
    // when the AI gateway is unreachable, so a visitor never sees a dead
    // widget just because the backend isn't deployed yet or is briefly down.
    function handleWithLocalFallback(text) {
      const typing = addTyping(body);
      setTimeout(() => {
        typing.remove();
        const lower = text.toLowerCase();

        if (/human|agent|representative|talk to (a )?person|موظف|بشري|شخص حقيقي/.test(lower)) {
          addBubble(body, s('humanHandoff'), 'bot');
          showLeadForm();
          record('[Escalation to human requested]', 'bot');
          return;
        }

        const answer = match(text);
        if (answer) {
          addBubble(body, answer, 'bot');
          record(answer, 'bot');
        } else {
          addBubble(body, s('fallback'), 'bot');
          record('[Fallback to lead capture]', 'bot');
          showLeadForm();
        }
      }, 700 + Math.random() * 400);
    }

    // Primary path: the real AI gateway (/api/chat → Claude, see
    // /api/chat.js). Streams newline-delimited JSON events and renders
    // text incrementally into a single bot bubble, executes any function
    // calls' results (lead saved / quote generated) as they resolve, and
    // updates the conversation state machine (§5) from the final event.
    async function handleWithAI(text) {
      const typing = addTyping(body);
      let bubble = null;
      let bubbleText = '';

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: VELIX.session.getToken(),
            message: text,
            history: aiHistory,
            state: conversationState,
            lang: getLang()
          })
        });

        if (!response.ok || !response.body) throw new Error('AI gateway unavailable');

        typing.remove();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalQuote = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // last (possibly incomplete) line stays in the buffer

          for (const line of lines) {
            if (!line.trim()) continue;
            let evt;
            try { evt = JSON.parse(line); } catch (e) { continue; }

            if (evt.type === 'text') {
              if (!bubble) bubble = addBubble(body, '', 'bot');
              bubbleText += evt.delta;
              bubble.innerHTML = escapeHtml(bubbleText).replace(/\n/g, '<br>');
              scrollToBottom(body);
            } else if (evt.type === 'tool_result') {
              if (evt.tool === 'generate_quote' && evt.result && evt.result.success) {
                finalQuote = evt.result.quote;
                addBubble(body, quoteCard(evt.result.quote), 'bot');
              } else if (evt.tool === 'create_lead' && evt.result && evt.result.success) {
                addBubble(body, `<em>${s('leadSavedNote')}</em>`, 'bot');
              } else if (evt.tool === 'escalate_to_human' && evt.result && evt.result.success) {
                addBubble(body, s('humanHandoff'), 'bot');
              }
            } else if (evt.type === 'done') {
              conversationState = evt.state || conversationState;
            } else if (evt.type === 'error') {
              throw new Error(evt.error || 'AI error');
            }
          }
        }

        if (bubbleText) {
          record(bubbleText, 'bot');
          aiHistory.push({ role: 'user', content: text });
          aiHistory.push({ role: 'assistant', content: bubbleText });
        } else if (finalQuote) {
          aiHistory.push({ role: 'user', content: text });
          aiHistory.push({ role: 'assistant', content: `[Quote generated: ${finalQuote.referenceNumber}]` });
        }
      } catch (err) {
        typing.remove();
        if (bubble) bubble.remove(); // partial stream — discard rather than show a broken half-answer
        aiUnavailable = true;
        handleWithLocalFallback(text);
      }
    }

    function handleUserMessage(text) {
      if (!text.trim()) return;
      addBubble(body, escapeHtml(text), 'user');
      record(text, 'user');
      input.value = '';

      if (aiUnavailable) {
        handleWithLocalFallback(text);
      } else {
        handleWithAI(text);
      }
    }

    toggle.addEventListener('click', () => {
      const isOpen = panel.classList.toggle('is-open');
      toggle.classList.toggle('is-open', isOpen);
      if (isOpen && !body.dataset.greeted) {
        body.dataset.greeted = '1';
        const typing = addTyping(body);
        setTimeout(() => {
          typing.remove();
          const greeting = s('greeting');
          addBubble(body, greeting, 'bot');
          record(greeting, 'bot');
          renderQuickReplies();
        }, 600);
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleUserMessage(input.value);
    });

    if (closeMobileBtn) {
      closeMobileBtn.addEventListener('click', closePanel);
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('is-open')) closePanel();
    });

    // Keep the chrome (labels, placeholders, quick replies not yet answered)
    // in sync if the visitor switches language mid-conversation. Messages
    // already sent stay as they were said — only the UI shell and any
    // not-yet-used quick replies refresh to the new language.
    document.addEventListener('velix:langchange', () => {
      toggle.setAttribute('aria-label', s('toggleOpen'));
      panel.setAttribute('aria-label', s('dialogLabel'));
      const nameEl = widget.querySelector('.velix-chat-name');
      const statusEl = widget.querySelector('.velix-chat-status');
      if (nameEl) nameEl.textContent = s('assistantName');
      if (statusEl) statusEl.textContent = s('assistantStatus');
      input.setAttribute('placeholder', s('inputPlaceholder'));
      input.setAttribute('aria-label', s('inputPlaceholder'));
      const sendBtn = form.querySelector('button[type="submit"]');
      if (sendBtn) sendBtn.setAttribute('aria-label', s('sendLabel'));
      if (closeMobileBtn) closeMobileBtn.setAttribute('aria-label', s('closeLabel'));
      if (quickWrap.childElementCount) renderQuickReplies();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
