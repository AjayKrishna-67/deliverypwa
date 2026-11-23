import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
    overwrite: true,
    schema: process.env.NEXT_PUBLIC_VENDURE_ADMIN_API || 'https://kaaikani.co.in/admin-api',
    config: {
        scalars: { Money: 'number' },
        namingConvention: { enumValues: 'keep' },
    },
    ignoreNoDocuments: true,
    generates: {
        // Generate TypeScript types from the schema
        'gql/generated.ts': {
            plugins: ['typescript'],
        },
    },
};

export default config;
