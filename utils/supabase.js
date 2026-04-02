// Supabase Realtime client for Meeting Brief Relay
// This module handles pushing/receiving private late-joiner briefs

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
let supabaseClient = null;
let realtimeChannel = null;

/**
 * Get stored Supabase credentials
 */
export async function getSupabaseConfig() {
  const result = await chrome.storage.local.get(['supabase_url', 'supabase_anon_key']);
  return {
    url: result.supabase_url || null,
    anonKey: result.supabase_anon_key || null
  };
}

/**
 * Initialize Supabase client
 */
export async function initSupabase() {
  const config = await getSupabaseConfig();
  if (!config.url || !config.anonKey) {
    console.warn('[MeetingCopilot] Supabase not configured — late joiner relay disabled');
    return null;
  }

  try {
    const { createClient } = await import(SUPABASE_CDN);
    supabaseClient = createClient(config.url, config.anonKey);
    console.log('[MeetingCopilot] Supabase client initialized');
    return supabaseClient;
  } catch (err) {
    console.error('[MeetingCopilot] Failed to init Supabase:', err);
    return null;
  }
}

/**
 * Push a late-joiner brief to Supabase (called by HOST)
 */
export async function pushBrief(meetingId, briefContent, targetParticipant) {
  if (!supabaseClient) await initSupabase();
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient
    .from('meeting_briefs')
    .insert({
      meeting_id: meetingId,
      brief_content: briefContent,
      target_participant: targetParticipant
    })
    .select()
    .single();

  if (error) {
    console.error('[MeetingCopilot] Failed to push brief:', error);
    return null;
  }

  console.log('[MeetingCopilot] Brief pushed for', targetParticipant);
  return data;
}

/**
 * Subscribe to briefs for a specific meeting (called by LATE JOINER)
 * @param {string} meetingId - The Google Meet room ID
 * @param {function} onBriefReceived - Callback when a brief arrives
 */
export async function subscribeToBriefs(meetingId, onBriefReceived) {
  if (!supabaseClient) await initSupabase();
  if (!supabaseClient) return null;

  // Also fetch any existing briefs for this meeting
  const { data: existing } = await supabaseClient
    .from('meeting_briefs')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    onBriefReceived(existing[0]);
  }

  // Subscribe to new briefs via Realtime
  realtimeChannel = supabaseClient
    .channel(`briefs-${meetingId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'meeting_briefs',
        filter: `meeting_id=eq.${meetingId}`
      },
      (payload) => {
        console.log('[MeetingCopilot] Brief received via Realtime:', payload.new);
        onBriefReceived(payload.new);
      }
    )
    .subscribe();

  console.log('[MeetingCopilot] Subscribed to briefs for meeting:', meetingId);
  return realtimeChannel;
}

/**
 * Unsubscribe from briefs
 */
export async function unsubscribe() {
  if (realtimeChannel && supabaseClient) {
    await supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

/**
 * Push live meeting state to Supabase for late joiners to pull
 */
export async function pushMeetingState(meetingId, state) {
  if (!supabaseClient) await initSupabase();
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient
    .from('meeting_state')
    .upsert({
      meeting_id: meetingId,
      summary: state.summary,
      topics: state.topics,
      decisions: state.decisions,
      action_items: state.actionItems,
      current_topic: state.currentTopic,
      participants: state.participants,
      updated_at: new Date().toISOString()
    }, { onConflict: 'meeting_id' })
    .select()
    .single();

  if (error) {
    console.error('[MeetingCopilot] Failed to push meeting state:', error);
  }
  return data;
}
