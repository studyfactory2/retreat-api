import { Module } from '@nestjs/common';
import { AccessLinkVault } from './access-link-vault.service';

@Module({
  providers: [AccessLinkVault],
  exports: [AccessLinkVault],
})
export class AccessLinkVaultModule {}
