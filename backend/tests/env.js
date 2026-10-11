// Must be imported before anything that reads configuration (ES imports are hoisted).
process.env.NODE_ENV = 'test';
process.env.WITHDRAWAL_REQUESTS_ENABLED = 'true'; // the retained staff workflow is still tested; a separate test covers the retired default
