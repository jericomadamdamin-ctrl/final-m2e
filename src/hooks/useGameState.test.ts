import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGameState } from './useGameState';
import * as backend from '@/lib/backend';
import * as session from '@/lib/session';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';

// Mock dependencies
vi.mock('@/lib/backend', () => ({
    fetchGameState: vi.fn(),
    gameAction: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
    getSession: vi.fn(),
    clearSession: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
    useToast: () => ({ toast: vi.fn() }),
}));

describe('useGameState', () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, null, children);

    const mockState = {
        oil_balance: 100,
        diamond_balance: 10,
        minerals: { bronze: 5 },
    };
    const mockMachines = [{ id: '1', type: 'mini', level: 1 }];
    const mockConfig = { pricing: {} };

    const mockResponse = {
        state: mockState,
        machines: mockMachines,
        config: mockConfig,
        profile: { player_name: 'TestUser' },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (session.getSession as any).mockReturnValue({ userId: 'user1' });
        (backend.fetchGameState as any).mockResolvedValue(mockResponse);
    });

    it('initializes and fetches game state', async () => {
        const { result } = renderHook(() => useGameState(), { wrapper });

        expect(result.current.loading).toBe(true);

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.player).toEqual(expect.objectContaining({
            oilBalance: 100,
            diamondBalance: 10,
        }));
        expect(result.current.machines).toHaveLength(1);
        expect(backend.fetchGameState).toHaveBeenCalled();
    });

    it('handles fetch error', async () => {
        (backend.fetchGameState as any).mockRejectedValue(new Error('Fetch failed'));

        const { result } = renderHook(() => useGameState(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBe('Fetch failed');
    });

    it('optimistically updates state on action', async () => {
        const { result } = renderHook(() => useGameState(), { wrapper });
        await waitFor(() => expect(result.current.loading).toBe(false));

        const actionResponse = {
            state: { ...mockState, oil_balance: 50 }, // Spent 50 oil
            machines: [...mockMachines, { id: '2', type: 'mini' }],
        };
        (backend.gameAction as any).mockResolvedValue(actionResponse);

        await act(async () => {
            await result.current.buyMachine('mini');
        });

        await waitFor(() => expect(result.current.player?.oilBalance).toBe(100));
        expect(result.current.machines).toHaveLength(1);
    });
});
