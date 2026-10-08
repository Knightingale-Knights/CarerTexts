const env = process.env;

const { normalizePhone } = require('./util');

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

// Bubble Data API field keys. Run `npm run probe` to confirm these match your app.
const defaultFields = {
  address: 'address_geographic_address',
  attendStart: 'attend start_date',
  attendEnd: 'attend end_date',
  attended: 'attended_boolean',
  cancelled: 'cancelled_boolean',
  carer: 'carer_user',
  date: 'date_date',
  startTime: 'start time_number',
  endTime: 'end time_number',
  progressNote: 'progress note_custom_progress_note',
  participant: 'participant_user',
  location: 'location_custom_locations',
  locationName: 'name_text',
  userFirstName: 'first name_text',
  userPhone: 'phone number_text',
};

function loadFields() {
  if (!env.BUBBLE_FIELDS_JSON) return defaultFields;
  try {
    return { ...defaultFields, ...JSON.parse(env.BUBBLE_FIELDS_JSON) };
  } catch (e) {
    throw new Error('BUBBLE_FIELDS_JSON is not valid JSON');
  }
}

module.exports = {
  tz: env.TZ_NAME || 'Australia/Melbourne',
  radiusM: num(env.RADIUS_M, 500),
  maxAccuracyM: num(env.MAX_ACCURACY_M, 200),
  refreshMin: num(env.REFRESH_MIN, 15),
  publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  linkSecret: env.LINK_SECRET || '',
  // Shared secret Klarra sends when it asks for an early check-out link
  klarraSecret: env.KLARRA_SHARED_SECRET || '',
  smsMode: env.SMS_MODE === 'live' ? 'live' : 'dry',
  // Test switch: when set, texts go only to this number (e.g. 0412345678). Nothing is written to Supabase.
  onlyPhone: env.ONLY_PHONE ? normalizePhone(env.ONLY_PHONE) : null,
  bubble: {
    base: (env.BUBBLE_API_BASE || '').replace(/\/$/, ''),
    token: env.BUBBLE_API_TOKEN || '',
  },
  twilio: {
    sid: env.TWILIO_ACCOUNT_SID || '',
    token: env.TWILIO_AUTH_TOKEN || '',
    from: env.TWILIO_FROM || '+61483931556',
  },
  supabase: {
    url: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    key: env.SUPABASE_SERVICE_KEY || '',
  },
  fields: loadFields(),
};
