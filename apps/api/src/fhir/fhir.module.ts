import { Module } from "@nestjs/common";
import { FhirClient } from "@clinicpilot/fhir-client";

import { fhirBaseUrl } from "./config";
import { InternalFhirController } from "./fhir.controller";
import { FHIR_CLIENT, FhirService } from "./fhir.service";

@Module({
  controllers: [InternalFhirController],
  providers: [
    {
      provide: FHIR_CLIENT,
      // One client per process. It holds no connection state — the credentials
      // it will hold once the sandbox is swapped for a real EHR are the reason
      // this lives in the gateway rather than in the AI service.
      useFactory: () => new FhirClient({ baseUrl: fhirBaseUrl() }),
    },
    FhirService,
  ],
  exports: [FhirService],
})
export class FhirModule {}
