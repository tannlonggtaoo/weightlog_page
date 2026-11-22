export const defaultBirthYear = 2000;
export const defaultHeight = 160;
const defaultWeight = 90;

export function isValidKcal(value) {
  return Number.isFinite(value) && value >= 0;
}

export function latestWeight(records) {
  let latest = null;
  let latestDay = "";
  let latestTime = -Infinity;
  for (const record of records) {
    if (record.type !== "weight" || !Number.isFinite(record.kg) || record.kg <= 0) continue;
    const day = record.at.slice(0, 10);
    const time = Date.parse(record.at);
    if (Number.isFinite(time) && (day > latestDay || (day === latestDay && time > latestTime))) {
      latest = record;
      latestDay = day;
      latestTime = time;
    }
  }
  return latest;
}

function summarizeEnergy(records, resting) {
  let intake = 0;
  let exercise = 0;
  let entryCount = 0;
  let missingCount = 0;
  for (const { type, kcal } of records) {
    if (type !== "food" && type !== "exercise") continue;
    entryCount++;
    if (!isValidKcal(kcal)) {
      missingCount++;
    } else if (type === "food") {
      intake += kcal;
    } else {
      exercise += kcal;
    }
  }

  // Include daily activity in the resting multiplier and estimate digestion from logged intake.
  const expenditure = resting * 1.25 + intake * 0.1 + exercise;
  const shownIntake = Math.round(intake);
  const shownExpenditure = Math.round(expenditure);
  return {
    intake: shownIntake,
    expenditure: shownExpenditure,
    balance: shownExpenditure - shownIntake,
    fraction: expenditure > 0 ? Math.min(intake / expenditure, 1) : 0,
    entryCount,
    missingCount
  };
}

export function summarizeDays(records, profile, includeDay) {
  const groups = new Map();
  if (includeDay) groups.set(includeDay, []);
  for (const record of records) {
    const day = record.at.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(record);
  }

  const birthYear = Number.isInteger(profile.birthYear) && profile.birthYear > 0 ? profile.birthYear : defaultBirthYear;
  const height = Number.isFinite(profile.height) && profile.height > 0 ? profile.height : defaultHeight;
  const sexCoefficient = profile.sex === "female" ? -161 : 5;
  let kg = defaultWeight;
  const days = [];
  // Carry each weigh-in forward by its recorded date, including days without a new measurement.
  for (const day of [...groups.keys()].sort()) {
    const dayRecords = groups.get(day);
    kg = latestWeight(dayRecords)?.kg ?? kg;
    const age = Number(day.slice(0, 4)) - birthYear;
    const resting = Math.max(0, 10 * kg + 6.25 * height - 5 * age + sexCoefficient);
    days.push({ day, records: dayRecords, energy: summarizeEnergy(dayRecords, resting) });
  }
  return days;
}
