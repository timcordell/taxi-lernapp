import { findYearClosestToRef } from "../../../calculation/years.js";
const PREFIX_PATTERN = /\b(?:last\s+day|end)\s+of\s+(?:the\s+)?$/i;
const RELATIVE_PERIOD_PATTERN = /^(this|last|past|next)\s*(week|month|year)$/i;
const RELATIVE_YEAR_SUFFIX_PATTERN = /^\s+(this|last|past|next)\s+year(?=\W|$)/i;
function modifierOffset(modifier) {
    return modifier === "next" ? 1 : modifier === "last" || modifier === "past" ? -1 : 0;
}
export default class ENEndOfPeriodRefiner {
    refine(context, results) {
        results.forEach((result) => {
            const prefix = context.text.substring(0, result.index).match(PREFIX_PATTERN);
            if (!prefix) {
                return;
            }
            const relativePeriod = result.text.match(RELATIVE_PERIOD_PATTERN);
            if (relativePeriod) {
                const modifier = relativePeriod[1].toLowerCase();
                this.moveToEndOfRelativePeriod(context, result, modifier, relativePeriod[2].toLowerCase());
            }
            else if (result.start.isCertain("month") && !result.start.isCertain("day")) {
                this.moveToEndOfMonth(context, result);
            }
            else {
                return;
            }
            result.start.imply("hour", 12);
            result.start.imply("minute", 0);
            result.start.imply("second", 0);
            result.start.imply("millisecond", 0);
            if (!result.start.isCertain("timezoneOffset")) {
                result.start.delete("timezoneOffset");
            }
            result.index -= prefix[0].length;
            result.text = prefix[0] + result.text;
            result.addTag("refiner/ENEndOfPeriodRefiner");
        });
        return results;
    }
    moveToEndOfRelativePeriod(context, result, modifier, period) {
        const offset = modifierOffset(modifier);
        const referenceDate = context.reference.getDateWithAdjustedTimezone();
        let lastDay;
        if (period === "week") {
            lastDay = new Date(referenceDate.getTime());
            lastDay.setDate(referenceDate.getDate() + (6 - referenceDate.getDay()) + offset * 7);
        }
        else if (period === "month") {
            lastDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + offset + 1, 0);
        }
        else {
            lastDay = new Date(referenceDate.getFullYear() + offset, 11, 31);
        }
        result.start.assign("day", lastDay.getDate());
        result.start.assign("month", lastDay.getMonth() + 1);
        result.start.assign("year", lastDay.getFullYear());
        result.start.delete("weekday");
        result.start.imply("weekday", lastDay.getDay());
    }
    moveToEndOfMonth(context, result) {
        let year = result.start.get("year");
        const month = result.start.get("month");
        const suffix = context.text.substring(result.index + result.text.length).match(RELATIVE_YEAR_SUFFIX_PATTERN);
        if (suffix) {
            const modifier = suffix[1].toLowerCase();
            const referenceYear = context.reference.getDateWithAdjustedTimezone().getFullYear();
            year = referenceYear + modifierOffset(modifier);
            result.start.assign("year", year);
            result.text += suffix[0];
        }
        if (!result.start.isCertain("year")) {
            const lastDayInReferenceYear = new Date(year, month, 0).getDate();
            year = findYearClosestToRef(context.reference.getDateWithAdjustedTimezone(), lastDayInReferenceYear, month);
            result.start.imply("year", year);
        }
        result.start.assign("day", new Date(year, month, 0).getDate());
    }
}
//# sourceMappingURL=ENEndOfPeriodRefiner.js.map