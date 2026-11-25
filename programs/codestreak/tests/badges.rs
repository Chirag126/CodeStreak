//! Phase 34: soulbound survivor badges (Token-2022 NonTransferable + on-mint metadata).
//! Build the program first, then run:  anchor build && cargo test -p codestreak
mod common;
use anchor_lang::solana_program::instruction::AccountMeta;
use common::*;
use DayResult::*;

const VERIFY_END: i64 = END + 600;
const DISPUTE_END: i64 = VERIFY_END + 900;

fn badge_mint(participant: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[BADGE_MINT_SEED, participant.as_ref()], &codestreak::ID).0
}
fn badge_authority() -> Pubkey {
    Pubkey::find_program_address(&[BADGE_AUTHORITY_SEED], &codestreak::ID).0
}
fn ata_2022(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), anchor_spl::token_2022::ID.as_ref(), mint.as_ref()], &anchor_spl::associated_token::ID).0
}

fn mint_badge_ix(payer: &Pubkey, challenge: &Pubkey, user: &Pubkey) -> Instruction {
    let participant = participant_pda(challenge, user);
    let mint = badge_mint(&participant);
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::MintBadge {
            payer: *payer,
            challenge: *challenge,
            participant,
            user: *user,
            badge_mint: mint,
            badge_authority: badge_authority(),
            user_badge_account: ata_2022(user, &mint),
            token_program: anchor_spl::token_2022::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::MintBadge {}.data(),
    }
}

/// Token amount of any SPL token account (Token-2022 accounts carry extensions after byte 165).
fn amount_of(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let data = svm.get_account(account).expect("token account missing").data;
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

/// A challenge where `survivor` verified every day and `loser` failed day 1, everyone finalized.
fn finished(env: &mut Env, id: u64) -> (Pubkey, Keypair, Keypair) {
    let challenge = create_pool(env, id, false, 10);
    let (survivor, _) = joined_user(env, &challenge, BUY_IN);
    let (loser, _) = joined_user(env, &challenge, BUY_IN);
    set_time(&mut env.svm, END);
    for day in 0..3u16 {
        send(&mut env.svm, verify_ix(&env.verifier.pubkey(), &challenge, &survivor.pubkey(), day, Verified), &[&env.verifier]).unwrap();
        let r = if day == 0 { Failed } else { Verified };
        send(&mut env.svm, verify_ix(&env.verifier.pubkey(), &challenge, &loser.pubkey(), day, r), &[&env.verifier]).unwrap();
    }
    (challenge, survivor, loser)
}

fn finalize(env: &mut Env, challenge: &Pubkey, users: &[&Keypair]) {
    set_time(&mut env.svm, DISPUTE_END);
    for u in users {
        send(&mut env.svm, finalize_ix(challenge, &u.pubkey()), &[&env.relayer]).unwrap();
    }
}

#[test]
fn survivor_gets_one_soulbound_badge_with_metadata() {
    let mut env = setup();
    let (challenge, survivor, loser) = finished(&mut env, 701);
    finalize(&mut env, &challenge, &[&survivor, &loser]);

    send(&mut env.svm, mint_badge_ix(&env.relayer.pubkey(), &challenge, &survivor.pubkey()), &[&env.relayer]).unwrap();

    let mint = badge_mint(&participant_pda(&challenge, &survivor.pubkey()));
    let account = ata_2022(&survivor.pubkey(), &mint);
    assert_eq!(amount_of(&env.svm, &account), 1, "exactly one badge in the survivor's own account");
    let mint_account = env.svm.get_account(&mint).unwrap();
    assert_eq!(mint_account.owner, anchor_spl::token_2022::ID, "a Token-2022 mint");
    assert_eq!(u64::from_le_bytes(mint_account.data[36..44].try_into().unwrap()), 1, "supply 1");
    assert_eq!(mint_account.data[44], 0, "0 decimals");
    // Phase 37.3: COption tag 0 = None. No mint or freeze authority, so wallets treat it as an NFT.
    assert_eq!(&mint_account.data[0..4], &[0, 0, 0, 0], "no mint authority: supply fixed at 1");
    assert_eq!(&mint_account.data[46..50], &[0, 0, 0, 0], "no freeze authority");
    let text = String::from_utf8_lossy(&mint_account.data);
    assert!(text.contains("CodeStreak Survivor · 3 days"), "name in the on-mint metadata");
    assert!(text.contains(BADGE_SYMBOL));
    assert!(text.contains(&format!("{}{}", BADGE_URI_BASE, participant_pda(&challenge, &survivor.pubkey()))), "fixed URI");
}

#[test]
fn badge_cannot_be_transferred() {
    let mut env = setup();
    let (challenge, survivor, loser) = finished(&mut env, 702);
    finalize(&mut env, &challenge, &[&survivor, &loser]);
    send(&mut env.svm, mint_badge_ix(&env.relayer.pubkey(), &challenge, &survivor.pubkey()), &[&env.relayer]).unwrap();
    let mint = badge_mint(&participant_pda(&challenge, &survivor.pubkey()));
    let from = ata_2022(&survivor.pubkey(), &mint);

    // Someone else's token account for the same mint (Associated Token program, "Create").
    let buyer = Keypair::new();
    let to = ata_2022(&buyer.pubkey(), &mint);
    let create = Instruction {
        program_id: anchor_spl::associated_token::ID,
        accounts: vec![
            AccountMeta::new(env.relayer.pubkey(), true),
            AccountMeta::new(to, false),
            AccountMeta::new_readonly(buyer.pubkey(), false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
            AccountMeta::new_readonly(anchor_spl::token_2022::ID, false),
        ],
        data: vec![],
    };
    send(&mut env.svm, create, &[&env.relayer]).unwrap();

    // Token-2022 TransferChecked (12): amount 1, decimals 0, signed by the owner.
    let mut data = vec![12u8];
    data.extend_from_slice(&1u64.to_le_bytes());
    data.push(0);
    let transfer = Instruction {
        program_id: anchor_spl::token_2022::ID,
        accounts: vec![
            AccountMeta::new(from, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(to, false),
            AccountMeta::new_readonly(survivor.pubkey(), true),
        ],
        data,
    };
    env.svm.airdrop(&survivor.pubkey(), 1_000_000_000).unwrap();
    let result = send(&mut env.svm, transfer, &[&survivor]);
    assert!(result.is_err(), "a soulbound badge must not move");
    assert_eq!(amount_of(&env.svm, &from), 1);
    assert_eq!(amount_of(&env.svm, &to), 0);
}

#[test]
fn non_survivors_and_unfinalized_players_cannot_mint() {
    let mut env = setup();
    let (challenge, survivor, loser) = finished(&mut env, 703);
    // Not finalized yet (even though every day is verified).
    expect_anchor_error(send(&mut env.svm, mint_badge_ix(&env.relayer.pubkey(), &challenge, &survivor.pubkey()), &[&env.relayer]), "NotSurvivor");
    finalize(&mut env, &challenge, &[&survivor, &loser]);
    // Failed player.
    expect_anchor_error(send(&mut env.svm, mint_badge_ix(&env.relayer.pubkey(), &challenge, &loser.pubkey()), &[&env.relayer]), "NotSurvivor");
}

#[test]
fn double_mint_fails() {
    let mut env = setup();
    let (challenge, survivor, loser) = finished(&mut env, 704);
    finalize(&mut env, &challenge, &[&survivor, &loser]);
    send(&mut env.svm, mint_badge_ix(&env.relayer.pubkey(), &challenge, &survivor.pubkey()), &[&env.relayer]).unwrap();
    expect_anchor_error(send(&mut env.svm, mint_badge_ix(&env.relayer.pubkey(), &challenge, &survivor.pubkey()), &[&env.relayer]), "BadgeAlreadyMinted");
    let mint = badge_mint(&participant_pda(&challenge, &survivor.pubkey()));
    assert_eq!(amount_of(&env.svm, &ata_2022(&survivor.pubkey(), &mint)), 1, "still exactly one");
}

#[test]
fn sending_sol_to_the_badge_address_first_cannot_block_it() {
    let mut env = setup();
    let (challenge, survivor, loser) = finished(&mut env, 705);
    finalize(&mut env, &challenge, &[&survivor, &loser]);
    let mint = badge_mint(&participant_pda(&challenge, &survivor.pubkey()));
    env.svm.airdrop(&mint, 5_000_000).unwrap();
    send(&mut env.svm, mint_badge_ix(&env.relayer.pubkey(), &challenge, &survivor.pubkey()), &[&env.relayer]).unwrap();
    assert_eq!(amount_of(&env.svm, &ata_2022(&survivor.pubkey(), &mint)), 1);
}

#[test]
fn badge_always_goes_to_the_participant_wallet() {
    let mut env = setup();
    let (challenge, survivor, loser) = finished(&mut env, 706);
    finalize(&mut env, &challenge, &[&survivor, &loser]);
    // Swap in another wallet as `user` (and its token account): the address check refuses it.
    let thief = Keypair::new();
    let mut ix = mint_badge_ix(&env.relayer.pubkey(), &challenge, &survivor.pubkey());
    let mint = badge_mint(&participant_pda(&challenge, &survivor.pubkey()));
    ix.accounts[3].pubkey = thief.pubkey();
    ix.accounts[6].pubkey = ata_2022(&thief.pubkey(), &mint);
    expect_anchor_error(send(&mut env.svm, ix, &[&env.relayer]), "ConstraintAddress");
}

fn seal_ix(challenge: &Pubkey, user: &Pubkey) -> Instruction {
    let participant = participant_pda(challenge, user);
    Instruction {
        program_id: codestreak::ID,
        accounts: codestreak::accounts::SealBadge {
            participant,
            badge_mint: badge_mint(&participant),
            badge_authority: badge_authority(),
            token_program: anchor_spl::token_2022::ID,
        }
        .to_account_metas(None),
        data: codestreak::instruction::SealBadge {}.data(),
    }
}

/// Rewrites a minted badge to how Phase 34 left it (mint and freeze authority = the badge PDA),
/// so the upgrade path for badges that already exist on devnet can be tested.
fn make_old_style(env: &mut Env, mint: &Pubkey) {
    let mut account = env.svm.get_account(mint).unwrap();
    let auth = badge_authority();
    account.data[0..4].copy_from_slice(&[1, 0, 0, 0]);
    account.data[4..36].copy_from_slice(auth.as_ref());
    account.data[46..50].copy_from_slice(&[1, 0, 0, 0]);
    account.data[50..82].copy_from_slice(auth.as_ref());
    env.svm.set_account(*mint, account).unwrap();
}

#[test]
fn old_badges_can_be_sealed_by_anyone_and_only_lose_authority() {
    let mut env = setup();
    let (challenge, survivor, loser) = finished(&mut env, 707);
    finalize(&mut env, &challenge, &[&survivor, &loser]);
    send(&mut env.svm, mint_badge_ix(&env.relayer.pubkey(), &challenge, &survivor.pubkey()), &[&env.relayer]).unwrap();
    let mint = badge_mint(&participant_pda(&challenge, &survivor.pubkey()));
    make_old_style(&mut env, &mint);

    let anyone = Keypair::new();
    env.svm.airdrop(&anyone.pubkey(), 1_000_000_000).unwrap();
    send(&mut env.svm, seal_ix(&challenge, &survivor.pubkey()), &[&anyone]).unwrap();
    let data = env.svm.get_account(&mint).unwrap().data;
    assert_eq!(&data[0..4], &[0, 0, 0, 0], "mint authority removed");
    assert_eq!(&data[46..50], &[0, 0, 0, 0], "freeze authority removed");
    assert_eq!(u64::from_le_bytes(data[36..44].try_into().unwrap()), 1, "supply unchanged");
    assert_eq!(amount_of(&env.svm, &ata_2022(&survivor.pubkey(), &mint)), 1, "badge still in the player's wallet");
    assert!(String::from_utf8_lossy(&data).contains("CodeStreak Survivor · 3 days"), "metadata unchanged");

    // Running it again (or on a badge minted already sealed) changes nothing and doesn't fail.
    send(&mut env.svm, seal_ix(&challenge, &survivor.pubkey()), &[&anyone]).unwrap();
}

#[test]
fn seal_refuses_a_player_without_a_badge() {
    let mut env = setup();
    let (challenge, survivor, loser) = finished(&mut env, 708);
    finalize(&mut env, &challenge, &[&survivor, &loser]);
    // No badge minted for the loser: the mint account doesn't exist.
    assert!(send(&mut env.svm, seal_ix(&challenge, &loser.pubkey()), &[&env.relayer]).is_err());
}
