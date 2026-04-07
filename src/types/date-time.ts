export type DateFormatConfig = {
  dateKeyPattern: string;
  isoDatePattern: string;
  usDatePattern: string;
  longDatePattern: string;
  monthYearPattern: string;
  yearMonthLabelPattern: string;
  yearQuarterLabelPattern: string;
  quarterYearLabelPattern: string;
  isoDateTimePattern: string;
  usDateTimePattern: string;
};

export const DEFAULT_DATE_FORMAT_CONFIG: DateFormatConfig = {
  dateKeyPattern: "YYYYMMDD",
  isoDatePattern: "YYYY-MM-DD",
  usDatePattern: "MM/DD/YYYY",
  longDatePattern: "MMMM D, YYYY",
  monthYearPattern: "MMMM YYYY",
  yearMonthLabelPattern: "YYYY-MM",
  yearQuarterLabelPattern: "YYYY-[Q]Q",
  quarterYearLabelPattern: "[Q]Q YYYY",
  isoDateTimePattern: "YYYY-MM-DD[T]HH:mm:ss",
  usDateTimePattern: "MM/DD/YYYY hh:mm:ss A",
};
