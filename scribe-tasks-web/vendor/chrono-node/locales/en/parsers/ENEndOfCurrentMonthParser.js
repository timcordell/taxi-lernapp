import { AbstractParserWithWordBoundaryChecking } from "../../../common/parsers/AbstractParserWithWordBoundary.js";
const PATTERN = /(?:last\s+day|end)\s+of\s+(?:the\s+)?month(?=\W|$)/i;
export default class ENEndOfCurrentMonthParser extends AbstractParserWithWordBoundaryChecking {
    innerPattern() {
        return PATTERN;
    }
    innerExtract(context) {
        const targetDate = context.reference.getDateWithAdjustedTimezone();
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1;
        const lastDay = new Date(year, month, 0).getDate();
        const components = context.createParsingComponents();
        components.assign("day", lastDay);
        components.assign("month", month);
        components.assign("year", year);
        components.addTag("parser/ENEndOfCurrentMonthParser");
        return components;
    }
}
//# sourceMappingURL=ENEndOfCurrentMonthParser.js.map