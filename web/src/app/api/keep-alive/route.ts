import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

/**
 * API endpoint to keep Supabase database active
 * This endpoint performs a simple database query to prevent the database from pausing
 */
export async function GET() {
  try {
    // Perform a simple database query to keep it active
    // Using rpc('version') as it's a lightweight query that doesn't modify data
    const { error } = await supabase
      .rpc('version');

    if (error) {
      console.error('Keep-alive error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    console.log('Keep-alive ping successful at:', new Date().toISOString());
    return NextResponse.json(
      {
        success: true,
        message: 'Database keep-alive ping successful',
        timestamp: new Date().toISOString()
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Keep-alive failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
