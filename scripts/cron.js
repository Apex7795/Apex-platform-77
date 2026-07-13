const { pool } = require('../lib/db');

const LOCK_ID = 1000;
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

async function acquireLock() {
  const result = await pool.query(
    'SELECT pg_try_advisory_lock($1) as acquired',
    [LOCK_ID]
  );
  return result.rows[0].acquired;
}

async function releaseLock() {
  await pool.query(
    'SELECT pg_advisory_unlock($1) as released',
    [LOCK_ID]
  );
}

async function updateConversionScores() {
  console.log('Updating conversion scores...');
  try {
    const result = await pool.query(`
      UPDATE prospects
      SET
        conversion_score = CASE
          WHEN review_count > 50 THEN 30 + 30
          WHEN review_count > 20 THEN 30 + 20
          ELSE 30
        END +
        CASE
          WHEN rating >= 4.5 THEN 25
          WHEN rating >= 4.0 THEN 15
          ELSE 0
        END,
        conversion_probability = LEAST((
          (CASE
            WHEN review_count > 50 THEN 30 + 30
            WHEN review_count > 20 THEN 30 + 20
            ELSE 30
          END +
          CASE
            WHEN rating >= 4.5 THEN 25
            WHEN rating >= 4.0 THEN 15
            ELSE 0
          END) / 100.0) * 95, 95),
        review_velocity = (review_count - COALESCE(last_score_review_count, 0)) / NULLIF(EXTRACT(DAY FROM (NOW() - last_scored_at)), 0)
      WHERE last_scored_at IS NULL OR last_scored_at < NOW() - INTERVAL '24 hours'
      RETURNING id
    `);
    console.log(`Updated ${result.rowCount} prospects`);
  } catch (error) {
    console.error('Error updating conversion scores:', error);
    throw error;
  }
}

async function processBookedJobs() {
  console.log('Processing booked jobs...');
  try {
    const result = await pool.query(`
      UPDATE booked_jobs
      SET status = 'processed'
      WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '24 hours'
      RETURNING id
    `);
    console.log(`Processed ${result.rowCount} booked jobs`);
  } catch (error) {
    console.error('Error processing booked jobs:', error);
    throw error;
  }
}

async function cleanupOldRecords() {
  console.log('Cleaning up old records...');
  try {
    const result = await pool.query(`
      DELETE FROM booked_jobs
      WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '30 days'
      RETURNING id
    `);
    console.log(`Deleted ${result.rowCount} old records`);
  } catch (error) {
    console.error('Error cleaning up records:', error);
    throw error;
  }
}

async function runScheduler() {
  const acquired = await acquireLock();
  if (!acquired) {
    console.log('[SKIP] Could not acquire lock, another instance running');
    return;
  }

  try {
    console.log('[START] Scheduler running at', new Date().toISOString());

    await updateConversionScores();
    await processBookedJobs();
    await cleanupOldRecords();

    console.log('[SUCCESS] Scheduler completed at', new Date().toISOString());
  } catch (error) {
    console.error('[ERROR] Scheduler failed:', error);
    process.exit(1);
  } finally {
    await releaseLock();
    await pool.end();
  }
}

if (require.main === module) {
  // Set timeout to prevent hanging
  const timeout = setTimeout(() => {
    console.error('[TIMEOUT] Scheduler exceeded maximum runtime');
    process.exit(1);
  }, LOCK_TIMEOUT);

  runScheduler()
    .catch(error => {
      console.error('[FATAL]', error);
      process.exit(1);
    })
    .finally(() => clearTimeout(timeout));
}

module.exports = { runScheduler };
