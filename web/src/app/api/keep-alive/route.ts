import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * API endpoint to keep Supabase database active
 * This endpoint performs a simple database query to prevent the database from pausing
 * Note: This endpoint is intentionally public to allow external pinging
 * Supports both GET and HEAD methods - both will ping Supabase
 *
 * To ensure this works on Vercel:
 * 1. Make sure this file is in the correct location: /api/keep-alive/route.ts
 * 2. Verify your Vercel project settings don't have any redirect rules for /api routes
 * 3. Check that your vercel.json (if it exists) doesn't have any conflicting routes
 */
export const dynamic = 'force-dynamic'; // Ensure this route is never statically generated

// Function to ping Supabase database
async function pingSupabase() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    console.log('Supabase URL:', supabaseUrl ? 'SET' : 'NOT SET');
    console.log('Supabase Anon Key:', supabaseAnonKey ? 'SET' : 'NOT SET');

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing Supabase environment variables');
      return false;
    }

    console.log('Creating Supabase client...');
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Use a simple select query that will work on any Supabase database
    // This is more reliable than rpc('version') which may not exist
    console.log('Pinging Supabase database...');
    const { error } = await supabase
      .from('auth.users')  // auth.users table exists in all Supabase projects
      .select('id', { head: true, count: 'exact' })  // Just count rows, don't return data
      .limit(1);  // Limit to 1 row for efficiency

    if (error) {
      console.error('Keep-alive error:', error.message);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return false;
    }

    console.log('Keep-alive ping successful at:', new Date().toISOString());
    return true;
  } catch (err) {
    console.error('Keep-alive failed:', err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) {
      console.error('Stack trace:', err.stack);
    }
    return false;
  }
}

// Handle both GET and HEAD requests
export async function GET(request: Request) {
  const success = await pingSupabase();

  if (request.method === 'HEAD') {
    // For HEAD requests, just return a simple success response
    return new NextResponse(null, { status: success ? 200 : 500 });
  }

  // For GET requests, return JSON response
  if (success) {
    return NextResponse.json(
      {
        success: true,
        message: 'Database keep-alive ping successful',
        timestamp: new Date().toISOString()
      },
      { status: 200 }
    );
  } else {
    return NextResponse.json(
      { success: false, error: 'Database ping failed' },
      { status: 500 }
    );
  }
}

// Also handle HEAD requests explicitly
export async function HEAD() {
  const success = await pingSupabase();
  return new NextResponse(null, { status: success ? 200 : 500 });
}
