// Today's date in Québec (the shops' time zone).
export const localDate=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));
