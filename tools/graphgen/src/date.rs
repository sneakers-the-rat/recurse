//! Civil dates, in as few lines as the calendar needs.
//!
//! The bank ships its calendar as one file per calendar year, so the builder has to turn a day
//! count into a year and back. That is the whole requirement: no clocks, no zones, no parsing
//! beyond `YYYY-MM-DD`, and nothing that has to agree with a wall clock — the client counts days
//! in the player's *local* time and the builder only ever counts whole days from the epoch.
//!
//! Written out rather than taken from a crate because the builder is held to two dependencies
//! that have to agree with something outside it — a digest and a stemmer — and thirty lines of
//! Gregorian arithmetic is not a third. The algorithm is Howard Hinnant's `days_from_civil` and
//! its inverse, which are exact over any range this will ever see; the era trick is what makes
//! them branch-free about leap years.
//!
//! Day 0 is the epoch itself, so `civil_from_days(days_from_civil(d)) == d` for every date.

/// A calendar date, as the three numbers a file name is written from.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Date {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

impl Date {
    pub fn parse(text: &str) -> Result<Date, String> {
        let bad = || format!("a date should read YYYY-MM-DD, got {text:?}");
        let mut parts = text.trim().split('-');
        let year: i32 = parts.next().ok_or_else(bad)?.parse().map_err(|_| bad())?;
        let month: u32 = parts.next().ok_or_else(bad)?.parse().map_err(|_| bad())?;
        let day: u32 = parts.next().ok_or_else(bad)?.parse().map_err(|_| bad())?;
        if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            return Err(bad());
        }
        Ok(Date { year, month, day })
    }
}

/// Days from 1970-01-01 to this date. Negative before it.
pub fn days_from_civil(date: Date) -> i64 {
    let y = if date.month <= 2 { date.year - 1 } else { date.year } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    // Year within the era, 0..=399.
    let yoe = y - era * 400;
    let m = date.month as i64;
    let d = date.day as i64;
    // Day within the year, counting from March — which is what moves the leap day to the end
    // and so out of the way.
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The inverse: which date a day count from 1970-01-01 names.
pub fn civil_from_days(days: i64) -> Date {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    Date { year: (if m <= 2 { y + 1 } else { y }) as i32, month: m as u32, day: d as u32 }
}

/// Days in a calendar year, which is the length of that year's calendar file.
pub fn days_in_year(year: i32) -> usize {
    (days_from_civil(Date { year: year + 1, month: 1, day: 1 })
        - days_from_civil(Date { year, month: 1, day: 1 })) as usize
}

/// Which day of the year a date is, counting from 0.
pub fn day_of_year(date: Date) -> usize {
    (days_from_civil(date) - days_from_civil(Date { year: date.year, month: 1, day: 1 })) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(year: i32, month: u32, day: u32) -> Date {
        Date { year, month, day }
    }

    #[test]
    fn counts_days_from_the_unix_epoch() {
        assert_eq!(days_from_civil(d(1970, 1, 1)), 0);
        assert_eq!(days_from_civil(d(1970, 1, 2)), 1);
        assert_eq!(days_from_civil(d(1969, 12, 31)), -1);
        assert_eq!(days_from_civil(d(2026, 7, 26)), 20_660);
        // 2000 was a leap year and 1900 was not, which is the whole of the 400-year rule.
        assert_eq!(days_from_civil(d(2000, 3, 1)) - days_from_civil(d(2000, 2, 28)), 2);
        assert_eq!(days_from_civil(d(1900, 3, 1)) - days_from_civil(d(1900, 2, 28)), 1);
    }

    #[test]
    fn round_trips_every_date_for_a_few_centuries() {
        // Every day from 1900 to 2200, both ways. Cheap, and it is the only claim these two
        // functions make.
        let from = days_from_civil(d(1900, 1, 1));
        let to = days_from_civil(d(2200, 1, 1));
        for days in from..to {
            let date = civil_from_days(days);
            assert_eq!(days_from_civil(date), days, "{date:?}");
        }
    }

    #[test]
    fn parses_and_measures_years() {
        assert_eq!(Date::parse("2026-07-26").expect("valid"), d(2026, 7, 26));
        assert!(Date::parse("2026-07").is_err());
        assert!(Date::parse("2026-13-01").is_err());
        assert!(Date::parse("not a date").is_err());
        assert_eq!(days_in_year(2026), 365);
        assert_eq!(days_in_year(2028), 366);
        assert_eq!(day_of_year(d(2026, 1, 1)), 0);
        assert_eq!(day_of_year(d(2026, 12, 31)), 364);
    }
}
