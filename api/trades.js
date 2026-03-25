import { query } from '../lib/db.js';
export default async function handler(req, res) {
  try {
    const { rows } = await query(`select * from sf_trades where portfolio_id = 'main' order by created_at desc limit 50`);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(rows));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: error.message }));
  }
}
