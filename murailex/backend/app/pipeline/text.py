"""Comparison keys and deterministic high-risk lexical detection.

Nothing here changes transcript text. `match_key` produces a comparison key used only
to decide whether two engines heard the same token; displayed text always remains the
raw provider token or the reviewer's exact entry.
"""
from __future__ import annotations

import re
import unicodedata

ARABIC_DIACRITICS = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ]")
ARABIC_INDIC = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
ALEF_VARIANTS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي"})

ARABIC_CHAR = re.compile("[؀-ۿݐ-ݿࢠ-ࣿ]")
LATIN_CHAR = re.compile("[A-Za-z]")

UNCLEAR_MARKERS = {
    "inaudible": "[غير مسموع]",
    "unclear_name": "[اسم غير واضح]",
    "unclear_number": "[رقم غير واضح]",
    "overlap": "[تداخل]",
    "silence": "[صمت]",
}
MARKER_TRANSLATIONS = {
    "[غير مسموع]": "[inaudible]",
    "[اسم غير واضح]": "[unclear name]",
    "[رقم غير واضح]": "[unclear number]",
    "[تداخل]": "[overlap]",
    "[صمت]": "[silence]",
}


def match_key(token: str) -> str:
    t = unicodedata.normalize("NFKC", token)
    t = "".join(ch for ch in t if not unicodedata.category(ch).startswith("P"))
    t = ARABIC_DIACRITICS.sub("", t)
    t = t.translate(ARABIC_INDIC).translate(ALEF_VARIANTS)
    return t.casefold().strip()


def script_of(token: str) -> str:
    has_ar = bool(ARABIC_CHAR.search(token))
    has_la = bool(LATIN_CHAR.search(token))
    if has_ar and has_la:
        return "mixed"
    if has_ar:
        return "ar"
    if has_la:
        return "en"
    return "other"


def _keys(words: str) -> set[str]:
    return {match_key(w) for w in words.split()}


NUMBER_WORDS = _keys(
    "صفر واحد واحده وحده اثنين اثنان ثنين تنين اتنين ثلاث ثلاثه تلاته ثلاثة اربع اربعه أربعة خمس خمسه خمسة ست سته ستة "
    "سبع سبعه سبعة ثمان ثمانيه ثمانية تمنيه تسع تسعه تسعة عشر عشره عشرة عشرين ثلاثين تلاتين اربعين خمسين ستين سبعين ثمانين تسعين "
    "مئه مئة ميه مية مائه مائة ميتين مئتين الف الاف آلاف ألف ألفين الفين مليون ملايين مليار نص ربع "
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen "
    "nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion half quarter"
)
MONEY_WORDS = _keys(
    "ريال ريالات دولار دولارات درهم دراهم دينار دنانير جنيه جنيهات ليره ليرة يورو فلوس مبلغ مبالغ حواله حوالة قرض دين ديون "
    "راتب اجره أجرة كاش شيك rial riyal riyals dollar dollars usd dirham dinar pound pounds euro euros cash money payment "
    "paid pay loan debt check cheque transfer wire salary"
)
DATE_WORDS = _keys(
    "يناير فبراير مارس ابريل أبريل مايو يونيو يوليو اغسطس أغسطس سبتمبر اكتوبر أكتوبر نوفمبر ديسمبر محرم صفر ربيع جمادى رجب شعبان "
    "رمضان شوال القعده ذو الحجه السبت الاحد الأحد الاثنين الإثنين الثلاثاء الاربعاء الأربعاء الخميس الجمعه الجمعة امس أمس بكره "
    "بكرة اليوم تاريخ سنه سنة شهر اسبوع أسبوع "
    "january february march april may june july august september october november december monday tuesday wednesday "
    "thursday friday saturday sunday yesterday tomorrow today date year month week"
)
NEGATION_WORDS = _keys(
    "لا ما مش مو موب مب ماني مانا ماهو ماهي مافي مافيش ليس ليست لم لن لسا لسه ابدا أبدا ابد أبد ولا غير بدون "
    "no not never none nothing nobody neither nor cannot can't dont don't didn't doesn't isn't wasn't won't wouldn't "
    "haven't hasn't aren't weren't couldn't shouldn't"
)
ADMISSION_WORDS = _keys(
    "اعترف أعترف اعترفت أعترفت نعم ايوه أيوه ايوا اي إي اه آه صح صحيح طيب بلى اكيد أكيد سويت سويته عملت عملته قلت قلته "
    "خذيت أخذت اخذت ضربت ضربته yes yeah yep admit admitted confess confessed did done i did correct right true"
)
DENIAL_WORDS = _keys(
    "انكر أنكر انكرت أنكرت كذب كذاب مستحيل غلط ابدا أبدا deny denied denies lie lying false never wrong impossible"
)
THREAT_WORDS = _keys(
    "اقتل أقتل اقتلك أقتلك بقتلك بذبحك اذبح أذبح اذبحك أذبحك اضرب أضرب اضربك أضربك بضربك احرق أحرق اهدد أهدد تهديد "
    "هددني هدده سلاح مسدس سكين رصاص انتقم أنتقم اخطف أخطف بخطف kill killing shoot shooting stab hurt harm threat "
    "threaten threatened gun knife weapon burn kidnap revenge"
)
NAME_CUES = _keys("ابو أبو ام أم بن بنت ابن الشيخ شيخ الاستاذ الأستاذ استاذ أستاذ الدكتور دكتور السيد سيد يا اسمه اسمها اسمي mr mrs ms dr sheikh named")

DIGIT_RE = re.compile(r"\d")
CURRENCY_SYMBOL = re.compile(r"[$€£¥﷼]")

CRITICAL_RISKS = {"number", "money", "date", "name", "admission", "denial", "threat"}


def token_risks(text: str, prev_text: str | None = None, next_text: str | None = None, *, capitalised_is_name: bool = True) -> set[str]:
    key = match_key(text)
    risks: set[str] = set()
    if not key:
        return risks
    stripped = key[2:] if key.startswith("ال") and len(key) > 3 else key
    if DIGIT_RE.search(key) or key in NUMBER_WORDS or stripped in NUMBER_WORDS:
        risks.add("number")
    if CURRENCY_SYMBOL.search(text) or key in MONEY_WORDS or stripped in MONEY_WORDS:
        risks.add("money")
    if key in DATE_WORDS or stripped in DATE_WORDS:
        risks.add("date")
    if key in NEGATION_WORDS or key.endswith("n't"):
        risks.add("negation")
    if key in ADMISSION_WORDS:
        risks.add("admission")
    if key in DENIAL_WORDS:
        risks.add("denial")
    if key in THREAT_WORDS or stripped in THREAT_WORDS:
        risks.add("threat")
    if prev_text is not None and match_key(prev_text) in NAME_CUES and key not in NAME_CUES:
        risks.add("name")
    raw = text.strip("\"'([{")
    if capitalised_is_name and prev_text is not None and raw[:1].isupper() and LATIN_CHAR.match(raw[:1]) and not prev_text.rstrip().endswith((".", "?", "!")):
        if key not in {"i"}:
            risks.add("name")
    s = script_of(text)
    for neighbour in (prev_text, next_text):
        if neighbour is None:
            continue
        n = script_of(neighbour)
        if {s, n} == {"ar", "en"} or s == "mixed":
            risks.add("code_switch")
    return risks
