type ResponseConcurrencyBudgetState = {
  active: number;
};

type ResponseConcurrencyBudgetGlobal = typeof globalThis & {
  __loreResponseConcurrencyBudgets?: Map<string, ResponseConcurrencyBudgetState>;
};

const responseConcurrencyBudgetGlobal = globalThis as ResponseConcurrencyBudgetGlobal;
const responseConcurrencyBudgets =
  responseConcurrencyBudgetGlobal.__loreResponseConcurrencyBudgets ??
  (responseConcurrencyBudgetGlobal.__loreResponseConcurrencyBudgets = new Map());

export function acquireResponseConcurrencySlot(name: string, maxConcurrent: number): (() => void) | null {
  if (!name || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error("Invalid response concurrency budget");
  }

  const state = responseConcurrencyBudgets.get(name) ?? { active: 0 };
  if (state.active >= maxConcurrent) return null;

  state.active += 1;
  responseConcurrencyBudgets.set(name, state);
  let released = false;

  return () => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
    if (state.active === 0) responseConcurrencyBudgets.delete(name);
  };
}

export function releaseResponseConcurrencySlotOnSettled(response: Response, release: () => void): Response {
  if (!response.body) {
    release();
    return response;
  }

  const reader = response.body.getReader();
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          releaseOnce();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        releaseOnce();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        releaseOnce();
      }
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
