#!/usr/bin/env node

import { supa } from './src/lib/supabase.js';

const checkDatabaseSchema = async () => {
  console.log('🔍 Checking database schema...\n');

  try {
    // Check if users table exists and get its structure
    const { data: users, error: usersError } = await supa
      .from('users')
      .select('*')
      .limit(1);

    if (usersError) {
      console.log('❌ Error accessing users table:', usersError.message);
      return;
    }

    console.log('✅ Users table is accessible');

    // Try to get table schema information
    const { data: schemaInfo, error: schemaError } = await supa
      .rpc('get_table_schema', { table_name: 'users' });

    if (schemaError) {
      console.log('⚠️  Could not get schema info:', schemaError.message);
    } else {
      console.log('📋 Table schema:', schemaInfo);
    }

    // Test a simple insert to see what fields are available
    console.log('\n🧪 Testing field names...');
    
    const testData = {
      email: 'schema-test@example.com',
      password_hash: 'test-hash',
      name: 'Schema Test',
      specialty: 'clinic'
    };

    const { data: insertTest, error: insertError } = await supa
      .from('users')
      .insert(testData)
      .select()
      .single();

    if (insertError) {
      console.log('❌ Insert test failed:', insertError.message);
      console.log('   Code:', insertError.code);
      console.log('   Details:', insertError.details);
    } else {
      console.log('✅ Insert test successful');
      console.log('   Created user:', insertTest.name);
      
      // Clean up test user
      await supa.from('users').delete().eq('id', insertTest.id);
      console.log('   Test user cleaned up');
    }

  } catch (error) {
    console.error('❌ Schema check error:', error);
  }
};

checkDatabaseSchema();
